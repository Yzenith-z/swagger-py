import os
import json
import yaml
import httpx
from fastapi import FastAPI, Request, Form
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.responses import JSONResponse, HTMLResponse
from urllib.parse import urljoin, quote, urlparse

app = FastAPI()

# Mount static files
app.mount("/static", StaticFiles(directory="static"), name="static")

# Templates
templates = Jinja2Templates(directory="templates")

def resolve_ref(ref: str, root_spec: dict):
    """
    Resolve a local reference like '#/definitions/User' or '#/components/schemas/User'
    """
    if not isinstance(ref, str) or not ref.startswith('#/'):
        return None
    
    parts = ref.split('/')
    current = root_spec
    try:
        for part in parts[1:]:
            current = current[part]
        return current
    except (KeyError, TypeError):
        return None

def deep_resolve(node, root_spec: dict, depth=0, max_depth=10):
    """
    Recursively resolve references in a node.
    """
    if depth > max_depth:
        return node
    
    if isinstance(node, dict):
        if '$ref' in node:
            ref_val = node['$ref']
            resolved = resolve_ref(ref_val, root_spec)
            if resolved:
                # Merge resolved with current node (preserving description etc if needed, but usually ref replaces)
                # We recursively resolve the *resolved* content
                return deep_resolve(resolved, root_spec, depth + 1)
            return node
        else:
            return {k: deep_resolve(v, root_spec, depth) for k, v in node.items()}
    elif isinstance(node, list):
        return [deep_resolve(item, root_spec, depth) for item in node]
    else:
        return node

def generate_example(schema, depth=0, max_depth=5):
    """
    Generate a dummy example JSON object from a schema.
    """
    if depth > max_depth:
        return "..."
    
    if not schema or not isinstance(schema, dict):
        return {}
    
    t = schema.get('type')
    if not t and 'properties' in schema:
        t = 'object'
    
    if t == 'object':
        props = schema.get('properties', {})
        example = {}
        for k, v in props.items():
            example[k] = generate_example(v, depth + 1)
        return example
    elif t == 'array':
        items = schema.get('items', {})
        return [generate_example(items, depth + 1)]
    elif t == 'string':
        fmt = schema.get('format')
        if fmt == 'date-time': return "2023-01-01T00:00:00Z"
        if fmt == 'date': return "2023-01-01"
        if 'enum' in schema: return schema['enum'][0]
        return schema.get('example', "string")
    elif t == 'integer':
        return schema.get('example', 0)
    elif t == 'number':
        return schema.get('example', 0.0)
    elif t == 'boolean':
        return schema.get('example', True)
    else:
        # Fallback
        return schema.get('example', {})

def load_spec_from_url(url: str):
    """
    Load OpenAPI/Swagger spec from a URL using httpx.
    Returns the parsed dict or None.
    """
    if not url.startswith(("http://", "https://")):
        print(f"Error: Invalid protocol. Only HTTP/HTTPS are supported.")
        return None

    try:
        response = httpx.get(url, follow_redirects=True, verify=False)
        response.raise_for_status()
        if url.endswith(('.yaml', '.yml')):
            return yaml.safe_load(response.text)
        else:
            return response.json()
    except Exception as e:
        print(f"Error loading spec: {e}")
        return None

def parse_spec(spec: dict, source_url: str):
    """
    Parse the raw spec into a structured format for the UI.
    Group operations by tags.
    Resolve server URL.
    """
    info = spec.get('info', {})
    
    # Determine Base URL
    base_url = "/"
    if 'servers' in spec:
        servers = spec.get('servers', [])
        if servers:
            # Simple logic: take the first one
            s_url = servers[0].get('url', '/')
            if not s_url.startswith('http') and source_url:
                base_url = urljoin(source_url, s_url)
            else:
                base_url = s_url
    else:
        host = spec.get('host', '')
        base_path = spec.get('basePath', '')
        schemes = spec.get('schemes', ['https'])
        scheme = schemes[0] if schemes else 'https'
        if host:
            base_url = f"{scheme}://{host}{base_path}"
        else:
             if source_url and source_url.startswith('http'):
                  parsed = urlparse(source_url)
                  origin = f"{parsed.scheme}://{parsed.netloc}"
                  base_url = urljoin(origin, base_path) if base_path else origin
             else:
                  base_url = base_path if base_path else "/"
    
    # Group by Tags
    paths = spec.get('paths', {})
    tags_map = {}
    
    for path, path_item in paths.items():
        # Handle path-level parameters (common to all operations in this path)
        common_params = path_item.get('parameters', [])
        
        for method, details in path_item.items():
            if method not in ['get', 'post', 'put', 'delete', 'patch', 'options', 'head', 'trace']:
                continue
            
            # Merge path-level parameters with operation parameters
            # Deduplicate by (name, in) - Operation parameters override Path parameters
            final_params = []
            seen_params = set()
            
            # 1. Add Operation parameters first (they take precedence)
            op_params = details.get('parameters', [])
            
            # 2. Merge common params
            details['parameters'] = common_params + op_params
                
            op_tags = details.get('tags', ['default'])
            for tag in op_tags:
                if tag not in tags_map:
                    tags_map[tag] = []
                
                # Enrich details
            details['path'] = path
            details['method'] = method.upper()
            details['operationId'] = details.get('operationId', f"{method}_{path}")
            
            # --- Resolve Parameters and Body ---
            
            # 1. Parameters
            if 'parameters' in details:
                resolved_params = []
                seen_keys = set()
                
                temp_resolved = []
                for param in details['parameters']:
                    # Resolve if it is a ref itself
                    p_resolved = deep_resolve(param, spec, max_depth=2)
                    
                    # Also resolve schema inside param if exists
                    if 'schema' in p_resolved:
                        p_resolved['schema'] = deep_resolve(p_resolved['schema'], spec, max_depth=5)
                    
                    temp_resolved.append(p_resolved)
                
                # Deduplicate: Keep the LAST occurrence of (name, in)
                unique_params_map = {}
                for p in temp_resolved:
                    key = (p.get('name'), p.get('in'))
                    if key[0] and key[1]: # Only if name and in exist
                        unique_params_map[key] = p
                    else:
                        unique_params_map[id(p)] = p
                
                details['parameters'] = list(unique_params_map.values())

            # 2. Request Body (OpenAPI 3)
            body_example = None
            if 'requestBody' in details:
                rb = details['requestBody']
                # Resolve the requestBody itself (it might be a ref)
                rb = deep_resolve(rb, spec, max_depth=2)
                if 'content' in rb:
                    for ct, media in rb['content'].items():
                        if 'schema' in media:
                            media['schema'] = deep_resolve(media['schema'], spec, max_depth=5)
                            if 'json' in ct:
                                try:
                                    body_example = json.dumps(generate_example(media['schema']), indent=2)
                                except:
                                    pass
                details['requestBody'] = rb
            
            # 3. Body Parameter (Swagger 2)
            # Find body param
            body_param = next((p for p in details.get('parameters', []) if p.get('in') == 'body'), None)
            details['body_param'] = body_param # Store for UI check
            
            if body_param:
                # Remove from parameters list to avoid duplication in UI
                details['parameters'] = [p for p in details['parameters'] if p.get('in') != 'body']
                
                if 'schema' in body_param:
                    # It's already resolved in step 1
                    try:
                        body_example = json.dumps(generate_example(body_param['schema']), indent=2)
                    except:
                        pass

            details['body_example'] = body_example
            
            tags_map[tag].append(details)

    # Convert to list for template
    tags_list = []
    # Sort tags if defined in spec
    defined_tags = {t['name']: t for t in spec.get('tags', [])}
    
    for tag_name, ops in tags_map.items():
        tag_desc = defined_tags.get(tag_name, {}).get('description', '')
        tags_list.append({
            "name": tag_name,
            "description": tag_desc,
            "operations": ops
        })
        
    return {
        "info": info,
        "base_url": base_url,
        "tags": tags_list,
        "spec_json": json.dumps(spec) # For raw view or debugging
    }

@app.get("/", response_class=HTMLResponse)
async def read_root(request: Request):
    return templates.TemplateResponse("index.html", {"request": request, "spec": None})

@app.post("/load-spec", response_class=HTMLResponse)
async def load_spec_route(request: Request, url: str = Form(...)):
    raw_spec = load_spec_from_url(url)
    
    if not raw_spec:
        return templates.TemplateResponse("index.html", {
            "request": request, 
            "error": "Failed to load spec from URL", 
            "url": url
        })
    
    parsed_data = parse_spec(raw_spec, url)
    
    return templates.TemplateResponse("index.html", {
        "request": request, 
        "spec": parsed_data,
        "url": url
    })

@app.post("/proxy")
async def proxy_request(request: Request):
    """
    Proxy API requests to avoid CORS and ensure httpx usage.
    Payload: { method, url, headers, params, body, client_proxy }
    Supports JSON payload or Multipart/Form-Data (with 'metadata' field).
    """
    content_type = request.headers.get("content-type", "")
    
    method = "GET"
    url = ""
    headers = {}
    params = {}
    body = None
    files = {}
    data = {}
    client_proxy = None

    try:
        if "multipart/form-data" in content_type:
            form = await request.form()
            metadata_str = form.get("metadata")
            if metadata_str:
                metadata = json.loads(metadata_str)
                method = metadata.get("method", "GET")
                url = metadata.get("url", "")
                
                # Security: Ensure URL is HTTP/HTTPS
                if not url or not url.startswith(("http://", "https://")):
                    return JSONResponse({"error": "Only HTTP/HTTPS protocols are supported"}, status_code=400)

                headers = metadata.get("headers", {})
                
                # Remove Content-Type from headers to allow httpx to set it correctly for multipart/boundary
                keys_to_remove = [k for k in headers.keys() if k.lower() == 'content-type']
                for k in keys_to_remove:
                    del headers[k]

                params = metadata.get("params", {})
                client_proxy = metadata.get("client_proxy")
            
            # Process other form fields as data or files
            for key, value in form.items():
                if key == "metadata":
                    continue
                if hasattr(value, "filename"):  # It's an UploadFile
                    files[key] = (value.filename, await value.read(), value.content_type)
                else:
                    data[key] = value
        else:
            # JSON Payload
            payload = await request.json()
            method = payload.get('method')
            url = payload.get('url')
            
            # Security: Ensure URL is HTTP/HTTPS
            if not url or not url.startswith(("http://", "https://")):
                return JSONResponse({"error": "Only HTTP/HTTPS protocols are supported"}, status_code=400)
            
            headers = payload.get('headers', {})
            params = payload.get('params', {})
            body = payload.get('body')
            client_proxy = payload.get('client_proxy')

        # Configure Proxy if provided
        proxy_url = None
        if client_proxy:
            # Ensure scheme is present
            if not client_proxy.startswith("http"):
                 client_proxy = "http://" + client_proxy
            proxy_url = client_proxy

        try:
            async with httpx.AsyncClient(verify=False, proxy=proxy_url) as client:
                req_kwargs = {
                    "method": method,
                    "url": url,
                    "headers": headers,
                    "params": params,
                    "follow_redirects": True
                }
                
                if files:
                    req_kwargs["files"] = files
                if data:
                    req_kwargs["data"] = data
                
                # If explicit body provided (JSON case)
                if body is not None and not files and not data:
                    if headers.get('Content-Type') == 'application/json':
                        req_kwargs['json'] = body
                    else:
                        req_kwargs['content'] = body

                resp = await client.request(**req_kwargs)
                
                # Safe JSON parsing
                json_data = None
                if resp.headers.get('content-type', '').startswith('application/json'):
                    try:
                        json_data = resp.json()
                    except ValueError:
                        json_data = None # Or maybe string content?

                return JSONResponse({
                    "status": resp.status_code,
                    "headers": dict(resp.headers),
                    "text": resp.text,
                    "json": json_data
                })
        except httpx.ProxyError as pe:
             return JSONResponse({"error": f"Proxy Error: {str(pe)}"}, status_code=502)
        except httpx.ConnectError as ce:
             return JSONResponse({"error": f"Connection Error: {str(ce)}"}, status_code=502)
        except Exception as e:
             return JSONResponse({"error": f"Request Error: {str(e)}"}, status_code=500)

    except Exception as e:
        return JSONResponse({"error": f"Server Error: {str(e)}"}, status_code=500)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
