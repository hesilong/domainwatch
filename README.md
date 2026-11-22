# DomainWatch · 域名到期时间看板

轻量级纯静态交互式网页，无需构建工具、后端数据库或用户登录。使用本地浏览器缓存域名，查询 RDAP 注册与到期日期，支持批量导入、搜索/后缀筛选、查询状态、CSV 导出。

## 本地命令行部署（Windows PowerShell，推荐）

```powershell
git pull origin main
New-Item -ItemType Directory -Force dist | Out-Null
Copy-Item index.html dist\\index.html -Force
npx wrangler@latest pages deploy dist --project-name=domainwatch --branch=main
```

请在仓库根目录执行，不要附加 `--config`：Wrangler Pages 不支持自定义配置路径，默认读取根目录的 `wrangler.toml`。保留仓库根目录的 `functions/` 及 `worker.js`，Pages 会随前端一起部署函数。独立 `domainwatch-rdap` Worker 如需更新，应执行 `npx wrangler@latest deploy --config wrangler.worker.toml`。

## 直接使用

1. 用 Chrome / Edge 打开 `index.html`。如果想跨设备访问，可将 `index.html` 部署为静态站点（如 Cloudflare Pages）。
2. 点击「添加域名」，一行一个粘贴域名，或导入 TXT、CSV、JSON。选择「导入并查询」。
3. 部署在 Cloudflare Pages 时，默认通过本站 `/api/rdap` 查询：普通域名走 RDAP，`.im` 域名走注册局 WHOIS（TCP 43）；直接用本地文件打开时才会直连 rdap.org，因浏览器跨域限制可能失败。
4. 可以点击每行刷新图标强制查询，或者点击「刷新 WHOIS」刷新全部，绕过浏览器本地缓存。

> 查询使用 RDAP，替代旧 WHOIS 的注册信息接口。不同后缀返回的字段/格式可能不同，日期缺失时 UI 会明确标注，而不会推测或伪造结果。请以注册商控制台中显示的实际续费时间为准。

## 推荐：Cloudflare Pages 一体化部署（无需独立 Worker）

项目根目录 `wrangler.toml` 已配置为 Pages（`pages_build_output_dir = "./dist"`）。项目内的 `functions/api/rdap.js` 由 Cloudflare Pages 自动识别，访问 `https://<你的项目>.pages.dev/api/rdap?domain=museora.im` 即可查询 `.im` WHOIS。若已通过 Git 集成部署，推送 GitHub 后 Pages 会自动重新构建；确保在 Cloudflare Pages 项目根目录能找到 `functions/`，并使用 Pages Git 集成部署，而不是仅上传 `dist` 的静态文件。

已部署的网站打开「查询设置」并清空旧的代理地址即可默认使用本站接口；`.im` 会优先使用本站接口，即使旧代理地址仍在。成功的 `.im` 查询可能只有到期时间，没有注册时间，这是注册局公开数据本身的限制。

**注意：** `.im` WHOIS 使用 Cloudflare 的出站 TCP Socket，实际能否连接取决于注册局是否接受该出口的连接。若出现 `WHOIS_LOOKUP_FAILED` 或 `WHOIS_TIMEOUT`，检查 Pages Function 日志，并可通过 [nic.im 官方 WHOIS 页面](https://www.nic.im/public/whois.mth) 手动确认。提交代码不代表线上查询已验证成功。

## 备选：独立部署 Cloudflare Worker 代理

本目录有 `worker.js` 和 `wrangler.toml`：

```sh
npx wrangler login
npx wrangler deploy --config wrangler.worker.toml
```

部署成功后获得类似 `https://domainwatch-rdap.<subdomain>.workers.dev` 的地址。打开网页「查询设置」，填写：

```
https://domainwatch-rdap.<subdomain>.workers.dev/api/rdap
```

Worker 只接收受校验的域名参数，`.im` 使用 WHOIS（`whois.nic.im:43`），其他后缀查询 RDAP 并统一映射 `registrationDate` / `expirationDate`，RDAP 上游缓存 6 小时，正常响应在客户端可缓存 7 天；查询失败只本地缓存 15 分钟。可修改 `wrangler.toml`，配置 `ALLOWED_ORIGIN` 将 CORS 收窄到已部署网站的源。如果网页从 `file://` 打开，浏览器可能传 `Origin: null`，此时不要设置只允许 HTTPS 源；建议将网页一起部署到 Cloudflare Pages。

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
## GitHub Actions 自动更新现有 Pages 项目

目前 Cloudflare Pages 项目 `domainwatch` 是 Direct Upload 创建的，**不会因 GitHub push 自动更新**，也不能原地转换为 Pages Git 集成。仓库增加了 `.github/workflows/deploy-pages.yml`，在添加两个 GitHub Secrets 后，可以直接更新原有 Pages 网站：

1. Cloudflare 控制台创建 Cloudflare API Token，Account 权限至少 `Cloudflare Pages: Edit`，并限制到相应账户。
2. GitHub 仓库 Settings → Secrets and variables → Actions 中新增 `CLOUDFLARE_API_TOKEN`（Token）以及 `CLOUDFLARE_ACCOUNT_ID`（账户 ID）。**不要将 Token 写入仓库或 README。**
3. 到 GitHub Actions → Deploy DomainWatch Pages → Run workflow → main 触发首次部署。以后 push main 自动部署。
4. 打开 `https://domainwatch-ba3.pages.dev/api/rdap?domain=museora.im` 验证 Pages Function。

工作流使用根目录 `wrangler.toml` 作为 Pages 配置，不使用 `--config`。独立 Worker 原配置保存在 `wrangler.worker.toml`。不会自动更新 `domainwatch-rdap` 独立 Worker；Pages 自己的 `/api/rdap` 已可处理普通 RDAP 及 `.im` WHOIS。

如果暂时不想使用 GitHub Actions，也可以在本地仓库根目录执行 `mkdir dist`、将 `index.html` 拷贝至 `dist/index.html`，然后 `npx wrangler pages deploy dist --project-name=domainwatch --branch=main` 手动更新。注意直接在 Cloudflare Pages 控制台拖放 `dist` 无法部署 `functions/`。

## 502 修复与检查（2026-11-22）

本次修复将普通后缀恢复为浏览器直接查询 RDAP（如果用户未填写自定义代理），避免 Pages Function 失效导致全站域名查询 502；仅 `.im` 默认走 Pages `/api/rdap`。后端支持 IANA RDAP 权威服务发现、`.im` 官方 HTTPS WHOIS 页面、WHOIS TCP 43 备用查询。未验证所有注册局在 Cloudflare 运行时环境下都能连通。

本地更新并部署：

```powershell
git pull origin main
New-Item -ItemType Directory -Force dist | Out-Null
Copy-Item index.html dist\index.html -Force
npx wrangler@latest pages functions build functions
npx wrangler@latest pages deploy dist --project-name=domainwatch --branch=main
```

部署完成检查：

- `https://domainwatch-ba3.pages.dev/api/rdap?health=1` 返回含版本 `2026-11-22.2` 的 JSON，证明新函数已部署
- `https://domainwatch-ba3.pages.dev/api/rdap?domain=museora.im` 优先查询官方 HTTPS WHOIS，失败时尝试 TCP；如返回 502，JSON 的 `detail` 提供具体故障类型
- 网站「查询设置」中的自定义代理留空，刷新 .com 等域名应走 `rdap.org`，只有 .im 走本地接口

若遇到 CORS 或 502，请使用 DevTools Network 查看 Response JSON 并检查 Pages Functions 日志，不要把 404 统一解释为域名不存在。

