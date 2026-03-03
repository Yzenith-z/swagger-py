function toggleTag(tagId) {
    const content = document.getElementById(tagId);
    if (content.style.display === "none" || !content.style.display) {
        content.style.display = "block";
    } else {
        content.style.display = "none";
    }
}

// --- Settings Modal Logic ---
function openSettingsModal() {
    document.getElementById("settingsModal").style.display = "block";
    loadSettingsUI();
}

function closeSettingsModal() {
    document.getElementById("settingsModal").style.display = "none";
}

// Close modal if user clicks outside of it
window.onclick = function(event) {
    const modal = document.getElementById("settingsModal");
    if (event.target == modal) {
        modal.style.display = "none";
    }
}

function saveSettings() {
    const proxyUrl = document.getElementById("globalProxy").value.trim();
    const baseUrl = document.getElementById("globalBaseUrl").value.trim();
    const headersStr = document.getElementById("globalHeaders").value.trim();
    
    // Validate JSON
    if (headersStr) {
        try {
            JSON.parse(headersStr);
        } catch (e) {
            alert("全局 Headers 必须是有效的 JSON！");
            return;
        }
    }

    const settings = {
        proxyUrl: proxyUrl,
        baseUrl: baseUrl,
        globalHeaders: headersStr
    };
    
    localStorage.setItem("swagger_ui_settings", JSON.stringify(settings));
    closeSettingsModal();
    alert("设置已保存！");
}

function loadSettingsUI() {
    const settingsStr = localStorage.getItem("swagger_ui_settings");
    if (settingsStr) {
        const settings = JSON.parse(settingsStr);
        document.getElementById("globalProxy").value = settings.proxyUrl || "";
        document.getElementById("globalBaseUrl").value = settings.baseUrl || "";
        document.getElementById("globalHeaders").value = settings.globalHeaders || "";
    }
}

function getSettings() {
    const settingsStr = localStorage.getItem("swagger_ui_settings");
    if (settingsStr) {
        try {
            return JSON.parse(settingsStr);
        } catch(e) { return {}; }
    }
    return {};
}

// --- Helper Functions for Request Execution ---

function getEffectiveBaseUrl() {
    const settings = getSettings();
    const docBaseUrlEl = document.getElementById('baseUrl');
    const docBaseUrl = docBaseUrlEl ? docBaseUrlEl.innerText.trim() : "";
    
    // 1. Global Setting
    if (settings.baseUrl && settings.baseUrl.trim()) {
        return settings.baseUrl.trim();
    }
    // 2. UI Spec Injection (Scanner)
    if (typeof uiSpec !== 'undefined' && uiSpec.base_url && uiSpec.base_url.trim()) {
        return uiSpec.base_url.trim();
    }
    // 3. Document Element (Single Request)
    if (docBaseUrl) {
        return docBaseUrl;
    }
    // 4. Fallback to Origin
    return window.location.origin;
}

async function executeProxyRequest({ method, url, headers, params, body, isMultipart, multipartParams, globalProxy }) {
    let fetchOptions = {};
    
    if (isMultipart) {
        const formData = new FormData();
        const metadata = {
            method: method.toUpperCase(),
            url: url.replace(/\/$/, ""),
            headers: headers,
            params: params,
            client_proxy: globalProxy
        };
        formData.append('metadata', JSON.stringify(metadata));
        
        if (multipartParams && multipartParams.length > 0) {
            multipartParams.forEach(p => {
                // p.value can be string or Blob
                if (p.value instanceof Blob) {
                     formData.append(p.name, p.value, p.filename || "file");
                } else {
                     formData.append(p.name, p.value);
                }
            });
        }
        
        fetchOptions = {
            method: 'POST',
            body: formData
        };
    } else {
        const proxyPayload = {
            method: method.toUpperCase(),
            url: url.replace(/\/$/, ""),
            headers: headers,
            params: params,
            body: body,
            client_proxy: globalProxy
        };
        
        fetchOptions = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(proxyPayload)
        };
    }

    try {
        const resp = await fetch('/proxy', fetchOptions);
        const result = await resp.json();
        return result;
    } catch (e) {
        return { error: e.toString() };
    }
}

// --- Scanner Logic ---
let isScanning = false;
let scanHistory = [];

let scanStats = { total: 0, success: 0, failed: 0 };
let currentSort = { field: null, order: 'asc' }; // 'asc' or 'desc'
const MAX_HISTORY = 1000;

function sortHistory(field) {
    if (currentSort.field === field) {
        // Toggle order
        currentSort.order = currentSort.order === 'asc' ? 'desc' : 'asc';
    } else {
        currentSort.field = field;
        currentSort.order = 'desc'; // Default to desc for numbers usually better
    }
    applySort();
}

function applySort() {
    if (!currentSort.field) {
        renderScanHistory();
        return;
    }
    
    scanHistory.sort((a, b) => {
        let valA = a[currentSort.field];
        let valB = b[currentSort.field];
        
        // Handle undefined/null
        if (valA === undefined || valA === null) valA = 0;
        if (valB === undefined || valB === null) valB = 0;
        
        if (valA < valB) return currentSort.order === 'asc' ? -1 : 1;
        if (valA > valB) return currentSort.order === 'asc' ? 1 : -1;
        return 0;
    });
    
    renderScanHistory();
    updateSortIcons();
}

function updateSortIcons() {
    // Reset all
    ['status', 'size'].forEach(f => {
        const icon = document.getElementById(`sortIcon-${f}`);
        if (icon) icon.className = "fas fa-sort";
    });
    
    // Set active
    if (currentSort.field) {
        const icon = document.getElementById(`sortIcon-${currentSort.field}`);
        if (icon) {
            icon.className = currentSort.order === 'asc' ? "fas fa-sort-up" : "fas fa-sort-down";
        }
    }
}

function openScannerModal() {
    document.getElementById("scannerModal").style.display = "block";
    renderScanHistory();
    updateScanStatsUI(); // Ensure stats are reset/shown
    // Reset buttons
    document.getElementById("btnStartScan").disabled = false;
    document.getElementById("btnStopScan").disabled = true;
}

function updateScanStatsUI() {
    document.getElementById("statTotal").innerText = scanStats.total;
    document.getElementById("statSuccess").innerText = scanStats.success;
    document.getElementById("statFailed").innerText = scanStats.failed;
}

function closeScannerModal() {
    document.getElementById("scannerModal").style.display = "none";
    if (isScanning) {
        stopScanner();
    }
}

async function startScanner() {
    if (isScanning) return;
    isScanning = true;
    
    // Reset Stats for new scan
    scanStats = { total: 0, success: 0, failed: 0 };
    scanHistory = []; // Clear history on new scan
    updateScanStatsUI();
    renderScanHistory();
    
    // UI State
    const btnStart = document.getElementById("btnStartScan");
    const btnStop = document.getElementById("btnStopScan");
    btnStart.disabled = true;
    btnStop.disabled = false;
    
    document.getElementById("scanStatus").innerText = "正在初始化...";
    
    const useEmptyBody = document.getElementById("scanUseEmptyBody").checked;
    const settings = getSettings();
    const globalProxy = settings.proxyUrl || null;
    
    const baseUrl = getEffectiveBaseUrl();

    let globalHeaders = {};
    if (settings.globalHeaders) {
        try { globalHeaders = JSON.parse(settings.globalHeaders); } catch(e){}
    }

    if (uiSpec.tags.length === 0) {
        alert("没有找到 API 操作！");
        isScanning = false;
        btnStart.disabled = false;
        btnStop.disabled = true;
        return;
    }

    // Flatten operations list
    const operations = [];
    uiSpec.tags.forEach(tag => {
        tag.operations.forEach(op => {
            operations.push(op);
        });
    });

    for (const op of operations) {
        if (!isScanning) break; // Check cancel
        document.getElementById("scanStatus").innerText = `正在扫描: ${op.method} ${op.path}`;
        
        let finalPath = op.path;
        const params = {};
        
        // Prepare Params
        if (op.parameters) {
            op.parameters.forEach(param => {
                if (param.in === 'body') return; // Handled separately
                
                // Generate dummy value
                let val = "test";
                if (param.type === 'integer' || param.type === 'number') val = 1;
                if (param.type === 'boolean') val = true;
                
                if (param.in === 'path') {
                    finalPath = finalPath.replace(`{${param.name}}`, encodeURIComponent(val));
                } else if (param.in === 'query') {
                    params[param.name] = val;
                }
            });
        }

        // Prepare Body
        let body = null;
        let isMultipart = false;
        let multipartParams = [];
        
        // Check OpenAPI 3 Multipart
        if (op.requestBody && op.requestBody.content && op.requestBody.content['multipart/form-data']) {
            isMultipart = true;
            const schema = op.requestBody.content['multipart/form-data'].schema;
            if (schema && schema.properties) {
                for (const [key, prop] of Object.entries(schema.properties)) {
                    multipartParams.push({
                        name: key,
                        value: prop.format === 'binary' ? new Blob(["dummy content"], { type: "text/plain" }) : (prop.default || "test"),
                        filename: prop.format === 'binary' ? "test.txt" : undefined
                    });
                }
            }
        } 
        // Check Swagger 2 FormData
        else if (op.parameters && op.parameters.some(p => p.in === 'formData')) {
             isMultipart = true;
             op.parameters.forEach(p => {
                 if (p.in === 'formData') {
                     multipartParams.push({
                         name: p.name,
                         value: p.type === 'file' ? new Blob(["dummy content"], { type: "text/plain" }) : (p.default || "test"),
                         filename: p.type === 'file' ? "test.txt" : undefined
                     });
                 }
             });
        }

        let headers = { ...globalHeaders };
        
        if (['POST', 'PUT', 'PATCH'].includes(op.method)) {
             if (!isMultipart) {
                headers['Content-Type'] = 'application/json';
                if (useEmptyBody) {
                    body = {};
                } else {
                    if (op.body_example) {
                        try {
                             body = JSON.parse(op.body_example);
                        } catch(e) { body = {}; }
                    } else {
                        body = {}; 
                    }
                }
             }
        }

        const startTime = Date.now();
        let status = 0;
        let responseData = null;
        let errorMsg = null;
        let size = 0;

        try {
            const result = await executeProxyRequest({
                method: op.method,
                url: baseUrl.replace(/\/$/, "") + finalPath,
                headers: headers,
                params: params,
                body: body,
                isMultipart: isMultipart,
                multipartParams: multipartParams,
                globalProxy: globalProxy
            });

            status = result.status || (result.error ? 500 : 0);
            responseData = result;
            if (result.error) errorMsg = result.error;
            
            if (result.text) {
                size = result.text.length;
            } else if (result.json) {
                size = JSON.stringify(result.json).length;
            }

        } catch (e) {
            errorMsg = e.message;
            status = 0;
        }

        const duration = Date.now() - startTime;
        
        // Record History
        const historyItem = {
            id: Date.now() + Math.random(),
            method: op.method,
            path: finalPath,
            status: status,
            duration: duration,
            size: size,
            request: {
                headers: headers,
                params: params,
                body: isMultipart ? "[Multipart 表单数据]" : body
            },
            response: responseData,
            error: errorMsg
        };
        
        // Update Stats
        scanStats.total++;
        if (status >= 200 && status < 300) {
            scanStats.success++;
        } else {
            scanStats.failed++;
        }
        updateScanStatsUI();
        
        scanHistory.unshift(historyItem);
        
        if (scanHistory.length > MAX_HISTORY) {
            scanHistory.pop();
        }

        if (currentSort.field) {
            applySort();
        } else {
            renderScanHistory();
        }
        
        await new Promise(r => setTimeout(r, 100));
    }

    isScanning = false;
    document.getElementById("scanStatus").innerText = "扫描完成";
    btnStart.disabled = false;
    btnStop.disabled = true;
}

function stopScanner() {
    isScanning = false;
    document.getElementById("scanStatus").innerText = "正在停止...";
}

function escapeHtml(text) {
    if (text === null || text === undefined) return "";
    return text
        .toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function renderScanHistory() {
    const tbody = document.getElementById("scanHistoryBody");
    tbody.innerHTML = "";
    
    scanHistory.forEach(item => {
        const tr = document.createElement("tr");
        
        let statusClass = "badge-status badge-warn";
        if (item.status >= 200 && item.status < 300) statusClass = "badge-status badge-success";
        else if (item.status === 0 || item.status >= 400) statusClass = "badge-status badge-error";
        
        let sizeStr = item.size + " B";
        if (item.size > 1024) sizeStr = (item.size / 1024).toFixed(2) + " KB";
        
        tr.innerHTML = `
            <td><span class="badge badge-method ${escapeHtml(item.method).toUpperCase()}">${escapeHtml(item.method)}</span></td>
            <td><div style="word-break: break-all; font-family: monospace; color: #0366d6;">${escapeHtml(item.path)}</div></td>
            <td><span class="badge ${statusClass}">${item.status || "Error"}</span></td>
            <td style="font-family: monospace;">${sizeStr}</td>
            <td style="font-family: monospace;">${item.duration} ms</td>
            <td>
                <button class="btn-icon" title="查看详情" onclick='showScanDetails("${item.id}")'>
                    <i class="fas fa-eye"></i> 详情
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function showScanDetails(id) {
    const item = scanHistory.find(x => x.id == id);
    if (!item) return;
    
    const reqPre = document.getElementById("scanDetailRequest");
    const respPre = document.getElementById("scanDetailResponse");
    
    reqPre.textContent = JSON.stringify(item.request, null, 2);
    if (item.error) {
        respPre.textContent = "错误: " + item.error;
    } else {
        respPre.textContent = JSON.stringify(item.response, null, 2);
    }
    
    document.getElementById("scanDetailsModal").style.display = "block";
}

// ----------------------------

function toggleOp(opId) {
    const op = document.getElementById(opId);
    const body = op.querySelector('.op-block-body');
    if (body.style.display === "none" || !body.style.display) {
        body.style.display = "block";
    } else {
        body.style.display = "none";
    }
}

async function executeRequest(method, path, opId) {
    const opBlock = document.getElementById('op-' + opId);
    const inputs = opBlock.querySelectorAll('.parameter__input');
    const bodyText = opBlock.querySelector('.body-param__text');
    
    const settings = getSettings();
    const globalProxy = settings.proxyUrl || null;
    let globalHeaders = {};
    if (settings.globalHeaders) {
        try { globalHeaders = JSON.parse(settings.globalHeaders); } catch(e){}
    }
    
    const baseUrl = getEffectiveBaseUrl();
    
    let url = baseUrl.replace(/\/$/, "") + path;
    let headers = {
        'Content-Type': 'application/json' 
    };
    const params = {};
    let body = null;
    
    headers = { ...headers, ...globalHeaders }; 
    
    let isMultipart = false;
    inputs.forEach(input => {
        if (input.type === 'file' || input.getAttribute('data-in') === 'formData') {
            isMultipart = true;
        }
    });

    let multipartParams = [];

    // Collect parameters
    inputs.forEach(input => {
        const name = input.getAttribute('data-name');
        const inLoc = input.getAttribute('data-in');
        
        if (input.type === 'file') {
            if (input.files.length > 0) {
                if (isMultipart) {
                    multipartParams.push({
                        name: name,
                        value: input.files[0],
                        filename: input.files[0].name
                    });
                }
            }
        } else {
            const value = input.value;
            if (value) {
                if (inLoc === 'path') {
                    url = url.replace(`{${name}}`, encodeURIComponent(value));
                } else if (inLoc === 'query') {
                    params[name] = value;
                } else if (inLoc === 'header') {
                    headers[name] = value;
                } else if (inLoc === 'formData') {
                    if (isMultipart) {
                        multipartParams.push({
                            name: name,
                            value: value
                        });
                    }
                }
            }
        }
    });

    if (!isMultipart && bodyText && bodyText.value) {
        try {
            body = JSON.parse(bodyText.value);
        } catch (e) {
            body = bodyText.value;
        }
    }

    // UI Updates - Reset
    const respContainer = document.getElementById('resp-' + opId);
    respContainer.style.display = 'block';
    const statusEl = document.getElementById('resp-status-' + opId);
    const bodyEl = document.getElementById('resp-body-' + opId);
    const headersEl = document.getElementById('resp-headers-' + opId);

    statusEl.innerHTML = '加载中...';
    bodyEl.innerText = '';
    headersEl.innerText = '';

    const result = await executeProxyRequest({
        method: method,
        url: url,
        headers: headers,
        params: params,
        body: body,
        isMultipart: isMultipart,
        multipartParams: multipartParams,
        globalProxy: globalProxy
    });

    // Render Result
    if (result.error && !result.status) {
        statusEl.innerHTML = '执行请求出错';
        bodyEl.innerText = result.error;
    } else {
        const status = result.status || (result.error ? 500 : 0);
        statusEl.innerHTML = `<strong>状态:</strong> ${status}`;
        
        if (result.json) {
            bodyEl.innerText = JSON.stringify(result.json, null, 2);
        } else {
            bodyEl.innerText = result.text || "";
        }
        
        if (result.headers) {
            headersEl.innerText = JSON.stringify(result.headers, null, 2);
        }
    }
}
