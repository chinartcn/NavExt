# 服务端 API

> RESTful 接口、项目 FS、扩展 FS、错误响应

[← 返回文档首页](README.md) · [← 返回主文档](../NavExt.md)

---

所有 API 在 /api/* 下，返回 JSON。受 server.json 的 api.* 控制。

GET /api/config

返回当前配置和扫描到的目录元数据。

```bash
curl http://localhost:3000/api/config
```

GET /api/extensions

返回所有扩展的列表和状态。

```json
{
  "count": 2,
  "enabled": true,
  "dir": ".js",
  "extensions": [
    {
      "id": "darkmode",
      "name": "暗色切换",
      "version": "1.0.0",
      "order": 10,
      "enabled": true,
      "hasConfig": true,
      "hasUserConfig": false
    }
  ]
}
```

GET /api/extensions/:id

返回单个扩展的详情，含 config 和 configSchema。

GET /api/extensions/:id/stats

返回扩展的运行统计。要求扩展实现 stats() 方法。

```bash
curl http://localhost:3000/api/extensions/my-ext/stats
```

响应：

```json
{
  "id": "my-ext",
  "stats": { "processed": 1234, "errors": 3, "uptime": 60000 }
}
```

未实现 stats() 的扩展返回 404。

POST /api/extensions/toggle

切换扩展的启用状态。修改 mod.json 的 enabled 字段并立即热重载。

```bash
# 显式设置
curl -X POST http://localhost:3000/api/extensions/toggle \
  -H 'Content-Type: application/json' \
  -d '{"id":"darkmode","enabled":false}'

# 翻转当前状态
curl -X POST http://localhost:3000/api/extensions/toggle \
  -H 'Content-Type: application/json' \
  -d '{"id":"darkmode","toggle":true}'
```

enabled 和 toggle 必须提供一个。

GET / POST / DELETE /api/extensions/:id/config

读取、更新、重置扩展配置。

```bash
# 读取（含 schema）
curl http://localhost:3000/api/extensions/starred/config

# 更新（合并写入，只更新请求体里出现的字段）
curl -X POST http://localhost:3000/api/extensions/starred/config \
  -H 'Content-Type: application/json' \
  -d '{"values":{"color":"#10b981","icon":"⭐"}}'

# 重置
curl -X DELETE http://localhost:3000/api/extensions/starred/config
```

响应字段：

字段 说明
schema 声明的字段列表，用于渲染表单
values 默认值 + 用户覆盖合并后的实际值
userValues 只包含用户显式覆盖的部分
hasUserValues 是否有任何用户覆盖

## 项目 FS（只读）

> ⚠️ **v2.8.1 起 `api.fs.write` 默认为 `false`**，即扩展文件写入端点
> （`/api/extensions/:id/fs/write|mkdir|rename|delete`）默认关闭。
> 写入扩展目录的内容会被热重载并作为 CommonJS 模块执行，而接口无鉴权，
> 默认开启等于开放远程代码执行。需要时在 server.json 显式打开：
> `{ "api": { "fs": { "write": true } } }`。
>
> 注意 `api.writable` 默认仍为 `true`——它管的是「改扩展配置」和「toggle 启停」，
> 这两个写的是纯数据（受 schema 约束的 config.json、mod.json 的 enabled 布尔），
> 无法注入可执行代码，所以保持默认可用。

```bash
# 列目录（all=1 显示隐藏项）
curl 'http://localhost:3000/api/fs/list?path='
curl 'http://localhost:3000/api/fs/list?path=docs&all=1'

# 文件信息
curl 'http://localhost:3000/api/fs/stat?path=index.html'

# 读文件（自动判断编码，或强制指定）
curl 'http://localhost:3000/api/fs/read?path=README.md'
curl 'http://localhost:3000/api/fs/read?path=logo.png&encoding=base64'
```

read 行为：

· 文本扩展名（.html / .js / .md / .json / .css / .svg 等）默认 utf8
· 二进制默认 base64
· 超过 maxReadSize 时截断并设 truncated: true
· utf8 解码遇到非法字节时自动回退 base64

## 扩展 FS（读写，v2.8.1 起默认关闭）

> 以下端点需要 `api.writable` **且** `api.fs.write`。后者默认 `false`，
> 原因与开启方式见上面「项目 FS」的说明。
> 列目录 / 读取（`fs/list`、`fs/read`、`fs/stat`）不受影响，仍然可用。

/api/extensions/:id/fs/* 语义与项目 FS 一致，但：

· 根目录是 .js/<id>/
· 允许列出隐藏文件
· 有写操作

```bash
# 列出
curl 'http://localhost:3000/api/extensions/starred/fs/list?path='

# 读取
curl 'http://localhost:3000/api/extensions/starred/fs/read?path=starred.json'

# 写入（自动创建父目录，除非 mkdirp: false）
curl -X POST http://localhost:3000/api/extensions/starred/fs/write \
  -H 'Content-Type: application/json' \
  -d '{"path":"starred.json","content":"[\"index.html\"]","encoding":"utf8"}'

# 创建目录
curl -X POST http://localhost:3000/api/extensions/starred/fs/mkdir \
  -H 'Content-Type: application/json' \
  -d '{"path":"cache/2024","recursive":true}'

# 重命名（目标必须不存在，否则 409）
curl -X POST http://localhost:3000/api/extensions/starred/fs/rename \
  -H 'Content-Type: application/json' \
  -d '{"from":"old.json","to":"archive/old.json"}'

# 删除（非空目录加 recursive=1）
curl -X DELETE 'http://localhost:3000/api/extensions/starred/fs/delete?path=old.json'
curl -X DELETE 'http://localhost:3000/api/extensions/starred/fs/delete?path=cache&recursive=1'
```

## 服务端搜索 `GET /api/search`

客户端 `NavExt.search(q, opts)` 的后端。在**已扫描文件的元数据**上做匹配与打分，
不解析 HTML 内容——所以搜不到 `<title>` 和正文（`html.json` 里的 `title` /
`description` 会被索引）。

```bash
curl --get --data-urlencode "q=入门" http://localhost:3000/api/search
```

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `q` | 必填 | 查询词，**非空**，空串返回 400 |
| `limit` | 50 | 单页条数，上限 **500**（超出自动收敛到 500） |
| `offset` | 0 | **v2.8.1 新增**，分页偏移量 |
| `dir` | — | 限定目录 |
| `hidden` | — | `=1` 时包含隐藏项 |

响应：

```json
{
  "query": "入门", "total": 1, "count": 1,
  "limit": 50, "offset": 0,
  "hasMore": false, "truncated": false,
  "items": [ { "rel": "docs/guide/intro.html", "score": 10 } ]
}
```

- `total` 是全部命中数，`count` 是本页条数
- `hasMore`：还有下一页（`offset + count < total`），**v2.8.1 新增**
- `truncated`：命中数超过本次返回的条数
- `offset` / `hasMore` 是 v2.8.1 新增字段，老客户端忽略即可，向后兼容

**分页示例**（宽泛查询命中上千条时）：

```bash
curl 'localhost:3000/api/search?q=page&limit=500&offset=0'
curl 'localhost:3000/api/search?q=page&limit=500&offset=500'
```

> **匹配规则**：打分要求**至少有一个字段同时包含全部词**（`title` > `name`
> > `rel` > `description`，命中位置越靠前分越高），未同时命中的字段按半权计分。
> 因此 `docs guide` 能命中 `docs/guide/x.html`（路径字段含两词），
> 但 `guide 入门` 匹配不到 `docs/guide/intro.html`——`guide` 在路径里、
> `入门` 在 `title` 里，分属不同字段。
>
> 搜索索引与导航页共用同一份文件列表，**`onFiles` 钩子裁掉的文件同样搜不到**。

---

## 错误响应

| 状态码 | 场景 |
| --- | --- |
| `400` | 参数错误、路径越界、目标冲突 |
| `403` | 对应的开关关闭，或路径越界 |
| `404` | 资源不存在 |
| `405` | 方法不支持 |
| `409` | 重命名目标已存在 |
| `413` | 请求体或写入内容超过限制 |

/api/* 路由在扩展的 onRequest 钩子之前处理。扩展拿不到 /api/ 开头的请求，避免误拦截。

---
