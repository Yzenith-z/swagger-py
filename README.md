# Enhanced Swagger UI & API Scanner

一个基于 **FastAPI** 的现代化 OpenAPI/Swagger 文档查看器与 API 自动化扫描工具。

本项目不仅提供标准的 API 文档浏览功能，还内置了强大的 **API 扫描器** 和 **CORS 代理服务**，解决了前端调试 API 时常见的跨域问题，并支持批量自动化测试接口连通性。

## ✨ 核心功能 (Features)

*   **📄 文档解析**: 支持通过 URL 加载 OpenAPI 3.0 和 Swagger 2.0 文档。
*   **🛡️ CORS 代理**: 内置后端代理服务 (`/proxy`)，彻底解决浏览器跨域 (CORS) 限制，让你可以直接在页面上测试任何 API。
*   **🤖 API 扫描器**:
    *   **自动化测试**: 一键扫描文档中的所有 GET/POST 接口。
    *   **智能参数**: 自动生成测试用的 Dummy 数据（支持 Path, Query, Body 参数）。
    *   **实时监控**: 实时显示扫描进度、成功/失败统计。
*   **📊 扫描历史**:
    *   **详细记录**: 记录每个请求的状态码、响应大小、耗时。
    *   **排序功能**: 支持按“状态码”或“响应大小”对历史记录进行排序，快速定位异常接口。
    *   **完整详情**: 查看请求头、请求体及完整响应内容（支持 JSON 格式化显示）。
    *   **内存管理**: 自动管理历史记录数量，防止长时间运行导致页面卡顿。
*   **🔒 安全增强**:
    *   **XSS 防护**: 对所有输出内容进行转义处理。
    *   **SSRF 防护**: 严格限制代理请求协议 (仅限 HTTP/HTTPS)。
    *   **健壮性**: 完善的错误处理机制，防止解析异常导致服务崩溃。

## 🛠️ 技术栈 (Tech Stack)

*   **Backend**: Python 3.8+, FastAPI, Uvicorn, Httpx
*   **Frontend**: HTML5, CSS3, Vanilla JavaScript (无繁重框架依赖)
*   **Template Engine**: Jinja2

## 🚀 快速开始 (Quick Start)

### 1. 环境准备

确保已安装 Python 3.x。

### 2. 安装依赖

```bash
cd fastapi_app
pip install -r requirements.txt
```

*依赖列表 (`requirements.txt`):*
*   fastapi
*   uvicorn
*   httpx
*   pyyaml
*   jinja2
*   python-multipart

### 3. 运行服务

```bash
# 开发模式（支持热重载）
uvicorn main:app --reload

# 或者直接运行脚本
python main.py
```

### 4. 访问应用

打开浏览器访问: [http://127.0.0.1:8000](http://127.0.0.1:8000)

## 📖 使用指南

1.  **加载文档**: 在顶部输入框粘贴你的 OpenAPI/Swagger JSON 或 YAML 地址 (例如: `http://localhost:8080/v3/api-docs`)，点击 "Explore"。
2.  **浏览接口**: 点击左侧或列表中的接口卡片查看详情。
3.  **单接口测试**: 点击 "Try it out" -> "Execute" 发送请求（自动通过后端代理）。
4.  **批量扫描**:
    *   点击右上角的 **"API 扫描器"** 按钮打开面板。
    *   配置选项（如是否使用空 Body）。
    *   点击 **"开始扫描"**。
    *   观察下方列表，点击表头可排序，点击 "详情" 查看具体响应。

## 📂 项目结构

```text
fastapi_app/
├── main.py              # FastAPI 后端核心逻辑 (代理、解析、路由)
├── requirements.txt     # 项目依赖
├── static/              # 静态资源
│   ├── css/
│   │   └── style.css    # 样式文件 (含 Flexbox 布局优化)
│   └── js/
│       └── script.js    # 前端逻辑 (扫描器、排序、UI交互)
└── templates/

## 截图
<img width="2494" height="1472" alt="image" src="https://github.com/user-attachments/assets/a529ad4d-1375-46a2-8346-d3c755db8f6d" />
<img width="2480" height="1486" alt="image" src="https://github.com/user-attachments/assets/fe1170f4-6ef8-4df6-9829-466c44af8d2b" />
<img width="2466" height="1396" alt="image" src="https://github.com/user-attachments/assets/13d015b5-1dc4-40ac-ba78-13b48f28ec4c" />



    └── index.html       # 主页面模板
```

## 📝 License

MIT License
