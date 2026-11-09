# DomainWatch · 域名到期时间看板

轻量级纯静态交互式网页，无需构建工具、后端数据库或用户登录。使用本地浏览器缓存域名，查询 RDAP 注册与到期日期，支持批量导入、搜索/后缀筛选、查询状态、CSV 导出。

## 直接使用

1. 用 Chrome / Edge 打开 `index.html`。如果想跨设备访问，可将 `index.html` 部署为静态站点（如 Cloudflare Pages）。
2. 点击「添加域名」，一行一个粘贴域名，或导入 TXT、CSV、JSON。选择「导入并查询」。
3. 默认浏览器直接访问 `https://rdap.org/domain/<域名>`。**某些注册局会阻止浏览器跨域查询**，出现「查询失败」是正常保护行为，此时部署下面的 Worker 并在「查询设置」填写代理 URL。
4. 可以点击每行刷新图标强制查询，或者点击「刷新 WHOIS」刷新全部，绕过浏览器本地缓存。

> 查询使用 RDAP，替代旧 WHOIS 的注册信息接口。不同后缀返回的字段/格式可能不同，日期缺失时 UI 会明确标注，而不会推测或伪造结果。请以注册商控制台中显示的实际续费时间为准。

## 推荐：部署 Cloudflare Worker 代理

本目录有 `worker.js` 和 `wrangler.toml`：

```sh
npx wrangler login
npx wrangler deploy
```

部署成功后获得类似 `https://domainwatch-rdap.<subdomain>.workers.dev` 的地址。打开网页「查询设置」，填写：

```
https://domainwatch-rdap.<subdomain>.workers.dev/api/rdap
```

Worker 只接收受校验的域名参数，查询 RDAP 服务器并统一映射 `registrationDate` / `expirationDate`，上游在 Cloudflare 边缘缓存 6 小时，正常响应在客户端可缓存 7 天；查询失败只本地缓存 15 分钟。可修改 `wrangler.toml`，配置 `ALLOWED_ORIGIN` 将 CORS 收窄到已部署网站的源。如果网页从 `file://` 打开，浏览器可能传 `Origin: null`，此时不要设置只允许 HTTPS 源；建议将网页一起部署到 Cloudflare Pages。

实际生产对外开放前，建议添加 Cloudflare 速率限制或 Turnstile 防刷。

## 支持的格式

纯文本：

```
example.com
my-brand.ai
something.app
```

CSV：

```csv
domain,registrationDate,expirationDate
example.com,2022-01-12,2027-01-12
my-brand.ai,2025-05-20,2027-05-20
```

JSON：

```json
{
  "records": [
    {"domain":"example.com","registrationDate":"2022-01-12","expirationDate":"2027-01-12"}
  ]
}
```

已经提供日期的域名会优先使用导入值，短期内免去重复查询；强制刷新会覆盖导入值。状态和查询数据会保存在当前浏览器的 localStorage。清除浏览器站点数据会清除记录，建议定期导出 CSV。

## 从书签脚本打开看板

上传网页以后，假设看板地址是 `https://domains.yoursite.com/`。原书签脚本已有域名列表时，可执行：

```js
const domains = ['example.com','my-brand.ai'];
window.open('https://domains.yoursite.com/#domains=' + encodeURIComponent(domains.join('\n')), '_blank');
```

原脚本已经查出 WHOIS / RDAP 日期时，无需重新查询：

```js
const records = [
  { domain: 'example.com', registrationDate: '2022-01-12', expirationDate: '2027-01-12' },
  { domain: 'my-brand.ai', registrationDate: '2025-05-20', expirationDate: '2027-05-20' }
];
window.open('https://domains.yoursite.com/#data=' + encodeURIComponent(JSON.stringify(records)), '_blank');
```

地址中的 payload 在导入后会自动移除，避免刷新页面再次导入。大量数据可能超出浏览器 URL 长度限制，建议分批或使用文件导入。此 demo 没有云端数据库，跨浏览器/设备的数据不会同步。

## 注意

- 默认按未来到期日期升序排序；已过期按距离现在最近排后面；未知日期最后。支持更改排序方式。
- `.example` 是保留后缀，演示数据不是实际 WHOIS 查询数据。
- 跨域限制、429、404、超时、日期缺失是不同情况，分别按失败或日期缺失显示。
- 仅接受域名，不会作为通用 URL 转发器，也不会读取域名归属人的隐私信息。