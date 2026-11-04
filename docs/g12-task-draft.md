# 方舟 G12 长程 Coding 任务草案

调研日期：2026-10-15。基线提交：`b60f6c8`（`main`）。本文只记录调研和任务设计，没有改产品代码。

交给模型的仓库不要包含本文件。模型只应看到下面「首轮 Prompt」那一节；评测标准、检查脚本和隐私清单留在验收侧。本文件若随仓库上传，模型会直接读到评分细则。

## 1. 仓库是什么

一点是工作与学习场景的收藏回看工具，当前版本 `1.3.4`，面向 Chrome 与 Edge 桌面浏览器（Manifest V3）。用户第 1 天收下整页或选段，进度变为 1/4；之后在第 2、7、30 天各回看一次。实现上，阶段 1、2、3 的间隔分别是 1 天、5 天、23 天，从实际完成时刻重算，所以晚看不会立刻堆出下一笔到期。记录留在这台浏览器里，不登录，也不把收藏发到网络。

产品对外的句子是「重要的，不只见一次」。文案用收下、回看、相见，避开打卡、逾期和掌握度。一次带回一条到期内容。看过之后可以记「用上了」（推进一次）、 「稍后再看」（推到 24 小时后，进度不变）或「不再需要」（进入可恢复的归档）。

仓库里还有一条已经写给编程助手的窄技能：`skills/yidian/SKILL.md`。它在对话里执行收下和回看，记录可以写到当前目录的《一点记录.md》。技能记录卡里有「这次先记住」和「和你现在的关系」。浏览器扩展的记录结构里没有这两句，只有用户选中的选段。

## 2. 架构

浏览器里跑的是 `extension/`。节奏、网址归一和记录规则写在 `core/domain.mjs`，并按字节复制到 `extension/domain.mjs`。`tests/core-sync.test.mjs` 会核对这两份文件是否一致。扩展直接读写 `chrome.storage.local`，不经过 `core/adapter.mjs`。适配器是给扩展以外的宿主用的内存实现和 JSON 文件实现。

主要表面：

| 位置 | 职责 |
| --- | --- |
| `core/domain.mjs` | 纯函数。网址规范化、1/2/7/30、进度、免打扰、搜索、统计、Markdown 导出、备份记录校验、重复项合并 |
| `extension/service-worker.mjs` | 模块化后台。收藏、闹钟、工具栏数字、可选通知、导入导出、归档、消息 |
| `extension/pet.js` | 用户点击图标或按快捷键时注入当前普通网页。没有常驻内容脚本，也没有 `host_permissions` |
| `extension/sidepanel.html` | 打开时的网页状态、下次回看、三种处理结果 |
| `extension/library.html` | 「我的收藏」，同时是选项页。今天看一条、搜索、归档、JSON 与 Markdown 导出、JSON 导入 |
| `extension/stats.html` | 本地回看统计。只汇总已经发生的事实 |
| `studio/` | ModelScope Static 创空间。互动演示、安装说明、隐私摘要、更新记录、联系页。不存放扩展安装包 |
| `skills/yidian/` | 对话里的收下与回看 |
| `tests/` | Node 内置测试运行器。`tests/e2e/upgrade.mjs` 用 Playwright 做真实浏览器升级检查，不在 `npm test` 里 |
| `scripts/release.ps1` | 核对版本和两份领域文件，跑 `npm run check` 与 `npm run test:e2e`，把 `extension/` 打成 ZIP |

权限是 `activeTab`、`alarms`、`notifications`、`scripting`、`sidePanel`、`storage`、`unlimitedStorage`。`minimum_chrome_version` 为 116。快捷键：`Ctrl+Shift+Y` 收下当前网页或选段，`Alt+Shift+Y` 打开侧边栏。

已经锁定、任务不能无意改掉的行为：

- 只接受 `http:` 与 `https:`。`javascript:`、`data:`、`file:` 不能当网页打开。升级时认不出的旧记录（包括 `file:///old-note`）留在 `unreadableRecords`，JSON 备份要带上它们。
- 网址归一会去掉 hash 和一串追踪参数，保留业务 query。`www` 与不带 `www` 目前是两条记录。
- 导入按 `normalizedUrl` 合并，较新的 `updatedAt` 胜出。超长字段或非法进度整批拒绝，不覆盖现有数据。单次导入上限 5000 条。
- 归档、恢复、删除和导入对收藏库与归档的写入要能在失败时保持原样。较旧备份不能把后来「不再需要」的内容重新变成待回看。
- `core/domain.mjs` 与 `extension/domain.mjs` 逐字节相同。
- 用户可见文案和统计页不出现连续天数、逾期数量、排名。

1.3.0 把 `recordsToMarkdown` 放进领域层，说明扩展、命令行和以后的笔记宿主共用这一份输出。收藏库可以导出 Markdown，导入控件仍只接受 JSON。技能写下的《一点记录.md》用的是另一套记录卡，扩展读不了。`studio/README.md` 写明下一步是本地文档、笔记和项目资料，同时写明不提前做通用多平台框架。

## 3. 规模

统计范围是工作区里除 `.git/` 和 `node_modules/` 以外的文件，时间是 2026-10-15。

| 口径 | 数量 |
| --- | --- |
| 文件 | 163（文本 132，二进制 31） |
| 文本行数 | 11,579 |
| 文本字符 | 450,718（ASCII 391,474，中文及全角 58,237，其他 1,007） |
| 文本字节 | 569,060 |
| 二进制字节 | 19,955,832，约 19.0 MiB |

Token 按混合文本估算，不是分词器实测量：

| 估算 | 口径 | 约数 |
| --- | --- | --- |
| 偏低 | ASCII/4.5 + 中文/1.8 + 其他/3 | 12.0 万 |
| 中位 | ASCII/4 + 中文/1.5 + 其他/2.5 | 13.7 万 |
| 偏高 | ASCII/3.2 + 中文/1.2 + 其他/2 | 17.1 万 |

文本字符按目录：

| 目录 | 文件 | 行 | 字符 |
| --- | --- | --- | --- |
| `extension/` | 17 | 2,680 | 127,296 |
| `tests/` | 14 | 2,512 | 113,956 |
| `docs/` | 76 | 4,334 | 111,457 |
| `studio/` | 12 | 1,112 | 63,226 |
| `core/` | 2 | 516 | 20,420 |
| 其余（README、脚本、技能、工作流、许可证） | 11 | 405 | 14,363 |

二进制主要是品牌配图和商店截图。`docs/brand/20260729-212534-yidian-redskill-v1-0/` 下 13 张 PNG 各约 1.2–1.7 MB。它们几乎不贡献 token。

和 512k 的关系：整库文本中位约 13.7 万 token，把所有文本读一遍到不了 512k。本任务不靠在 Prompt 里要求阅读次数或粘贴填充内容。它把必须同时成立的规则拆在领域层双份文件、后台导入、三处界面、技能记录卡和 127 个已有测试里。云端代理若保留完整对话，后段请求的输入是此前轮次的累积；这种跨模块实现通常要反复打开 `service-worker.mjs`（622 行）、两份 `domain.mjs`（各 440 行）和 `tests/worker-flow.test.mjs`（465 行）并带着失败日志继续改。按每轮新增约 1.2–2 万 token、30 轮以上估算，后段单轮输入会超过 512k。

若代理中途摘要历史，或模型只改领域层就停，峰值可能停在 20–30 万。这是仓库文本量决定的，不能靠把 `docs/` 贴进 Prompt 来凑。正式投稿前用一颗模型试跑，看轨迹里的最大输入。试跑达不到 512k 时，应换更大的仓库，而不是放宽「禁止凑 token」这条。

## 4. 测试与构建（已实际运行）

环境：Node.js `v22.14.0`。单元测试不需要安装依赖。

| 命令 | 结果 |
| --- | --- |
| `npm test` | 通过。127 项，0 失败，约 0.86 秒 |
| `npm run check` | 通过。同一套 127 项，随后 `node --check` 检查 `extension/domain.mjs`、`extension/pet.js`、`extension/service-worker.mjs`、`extension/library.js`，均无输出、退出码 0 |
| `npm run test:e2e` | 未进入浏览器。首次因找不到 `playwright` 退出。执行 `npm install` 后再次运行，断言失败：`studio/yidian-1.3.1.zip` 不存在。该 ZIP 被 Git 忽略，需要 `YIDIAN_OLD_ZIP` 或在 Windows 上用 `scripts/release.ps1` 生成。本次没有启动浏览器 |
| `scripts/release.ps1` | 未运行。当前环境没有 `powershell` 或 `pwsh`。脚本还会串联 `npm run check` 与 `npm run test:e2e`，并用 .NET 压缩 API 打包 |

因此本任务的机器验收以 `npm test` 和 `npm run check` 为准。不把 `npm run test:e2e` 列为模型必须跑通的命令。

## 5. 三个候选任务

往期范围：本仓库和 `endtree-FDE` 公开代码里没有名为 G12 的任务稿。已合并的产品改动是 1.0 发布、1.3.0 单向 Markdown 导出与每日摘要、1.3.2 升级隔离与侧边栏、1.3.4「今天看一条」。下面三个候选都避开这些已交付项。

### 候选 A：浏览器收藏和对话记录共用同一份记忆

难度：高。

用户现在有两条互不相通的路。收藏库能导出 Obsidian 风格的 Markdown，不能再导回来。技能写下的《一点记录.md》浏览器不认识。技能里的「这次先记住」没有地方可存。没有网页链接的笔记也进不了现有的网址主键。

要做对，必须同时读懂这些互相牵制的实现：`recordsToMarkdown` 的版式、`normalizeImportedRecord` 的整批拒绝、`mergeByKey` 与 `consolidateRecords` 的合并、`service-worker.mjs` 里导入与 `open-record` 对协议的限制、`unreadableRecords` 对 `file://` 的保留、宠物卡片、侧边栏和收藏库「今天看一条」的渲染顺序、技能记录卡的原文、以及 127 个测试里已经钉死的节奏、权限和字节同步。漏读任一处，就会把旧 JSON 备份导坏、把 `file://` 打开成网页，或让两份 `domain.mjs` 分叉。

这是三个候选里最适合长程评测的一个。验收可以落到数据、协议和界面文本上。

### 候选 B：同一篇文章不要收成两条

难度：中。

`normalizeUrl` 会去掉 hash 和一份西式追踪参数名单，测试把这个行为钉死了。`www.example.com` 与 `example.com` 仍是两条。中文站点常见的 `spm`、`scm`、分享参数不在名单里，带这些参数再次收下会新开一条。飞书、Notion 一类链接若把文档身份放在 hash 里，现有规则会把它们收成同一条；改 hash 规则会直接撞上 `tests/domain.test.mjs` 的既有断言。

改动面集中在 `core/domain.mjs`、它的扩展副本和领域测试。后台会跟着走，三处界面基本不用动。阅读量不足以自然到达 512k，也容易和「保留业务 query」的既有承诺打架。适合作为后续小任务，不适合这次长程评测。

### 候选 C：在现有 `skinId` 上做两到三款轻量配色

难度：中。

记录从第一天就保存 `skinId`，默认 `fluid-01`。下一代规格把轻量配色放在核心闭环之后，不做法商城、解锁和货币。1.3.4 的核心闭环已经在商店上线，这件事是真实的下一步，但不是用户当前卡住的那条路。

工作集中在 `pet.css`、`pet.js` 和设置项。节奏、导入和技能都不用动，阅读面窄。验收依赖视觉是否「轻量、不打扰」，客观分差会拉不开。

### 选择

采用候选 A。它是仓库里已经承诺、尚未接通的跨宿主记忆；做完能用数据和界面核对；做的过程必须读完整条收藏链路，而不是单文件补丁。

## 6. 选定任务

### 任务标题

让浏览器收藏和《一点记录.md》共用同一份记忆

### 首轮 Prompt

只把本节交给模型。

```text
我自己每天都在用一点。浏览器里收下的网页，和我在对话里用一点写下的《一点记录.md》，现在是两套记忆。

收藏库可以把收藏导出成 Markdown，我本来想丢进笔记里继续看。这个文件再导不回去。对话里那份记录卡，浏览器也不认识。结果同一篇东西，进度、下次回看，还有我当初为什么收下，对不上。

请在现在这个仓库上把这件事补上。不要另起一个产品，也不要做账号、云同步或皮肤商城。1、2、7、30 的节奏保持现在这样：晚看就从实际完成的时间往后算，不要一次塞回多条，也不要因为我晚了就批评我。

我要的使用方式：

我在「我的收藏」导出的 Markdown，再导入回去，还是原来那些收藏。进度、下次回看、选段、相见足迹和已归档都在。同一篇网页不要变成两条。

对话技能现在写下的记录卡也能导入。卡片里已经有的标题、来源、选段、「这次先记住」、「和你现在的关系」、进度和下次回看日期都要留下来。技能可以写得更稳一些，但按今天这份技能说明写出的卡片，仍然要能导入。

在网页上收下时，我可以留下一句「这次先记住」。以后网页上的宠物、侧边栏，还有收藏库里的「今天看一条」，都先让我看见这句话，选段还在。这句话没写时，不要空出一块。搜索要能搜到它。

来源不是网页链接的笔记，也按同样的节奏回来。打开它时在一点自己的页面里读。不要把它当成网页去打开，也不要为此去读我电脑上的文件。

以前导出的 JSON 备份还要能用。那些当年认不出的旧记录继续安静地留在备份里，不要突然变成可以打开的地址，也不要覆盖我现在的收藏。

语气别变。继续用收下、回看、相见。领域规则继续只保留一份，核心和扩展里的那份要保持一样。现有测试要过，新的行为也要有测试。
```

### 评测标准

七条都要查。每条单独给 S、A、B 或不合格。S 记 3 分，A 记 2 分，B 记 1 分，不合格记 0 分，满分 21。第 4 条或第 6 条为不合格时，总分封顶 12，避免「功能做完了，但把本地文件或危险协议打开了」排到前面。五个模型按总分排序；同分时依次比较第 1、5、2 条。

1. 收藏库导出的 Markdown 可以再导入。进度、下次回看时间、选段、足迹类型与顺序、归档分区保持原样。同一 `normalizedUrl` 再导一次不新增第二条。
2. `skills/yidian/SKILL.md` 现有记录卡形状可以导入。标题、规范化后的来源、选段、「这次先记住」、「和你现在的关系」、阶段、下次回看的北京日历日都在。
3. 宠物、侧边栏、收藏库「今天看一条」在回看时先展示「这次先记住」，选段仍在。句子为空时不留空块。收藏库搜索能命中这句话。
4. 来源不是 `http:` / `https:` 的笔记能进入同一套回看节奏，并在扩展自己的页面里阅读。打开动作不会导航到 `file:`、`javascript:` 或 `data:`。同一笔记导入两次不复制。
5. 旧 JSON 备份的合并、整批拒绝、5000 条上限和 `file://` 旧记录隔离保持原行为。Markdown 导入失败或与 JSON 混用时，不覆盖现有收藏。
6. 清单权限仍是现在这七项，没有 `host_permissions`。两份 `domain.mjs` 逐字节相同。扩展、创空间和技能的用户可见文案不新增「打卡」「逾期」「掌握度」。扩展代码不新增向外网发收藏内容的请求。
7. `npm test` 与 `npm run check` 通过。新增测试会在往返丢足迹、记录卡丢「这次先记住」、或笔记被当成网页打开时失败。收藏库上有一条真实可用的 Markdown 导入入口，说明文字和能力一致。

不要求改版本号，不要求跑通 `npm run test:e2e`。模型若改了版本，`package.json`、`extension/manifest.json` 和 `studio/` 里的缓存版本必须一起改，否则第 7 条最高 B。

### 逐条检查方法

验收在模型交回的工作区进行。先跑：

```bash
npm test
npm run check
git diff -- package.json extension/manifest.json
```

`npm test` 失败时，第 5 条和第 7 条先记为不合格，其余条仍按下面的独立脚本判断，不因测试失败就整份不看。

独立脚本放到 `/tmp/g12-check.mjs`，不要放回模型仓库。在模型交回的仓库根目录执行。脚本用当前目录的 `core/domain.mjs`，从导出里寻找能把 Markdown 解析成记录的函数，并用技能卡片的原文做探测。

```bash
node /tmp/g12-check.mjs
```

脚本内容：

```javascript
import { pathToFileURL } from 'node:url';

const domain = await import(pathToFileURL(`${process.cwd()}/core/domain.mjs`));

const now = Date.UTC(2026, 9, 15, 2, 0, 0);
const active = domain.createRecord({
  title: '评审笔记',
  url: 'https://notes.example.com/q3?utm_source=x',
  excerpt: '先写结论',
  now,
});
const stepped = domain.advanceRecord(active, now + 2 * domain.DAY_MS, 'used');
if (!stepped.changed) throw new Error('fixture failed to advance');
const archived = domain.createRecord({
  title: '已经放好的一篇',
  url: 'https://notes.example.com/old',
  excerpt: '归档选段',
  now: now - 40 * domain.DAY_MS,
});
archived.stage = 4;
archived.nextReviewAt = null;
const markdown = domain.recordsToMarkdown({
  records: [stepped.record],
  archived: [archived],
  exportedAt: '2026-10-15T02:00:00.000Z',
});

const skillCard = `已收下 · 还有 3 次回看

《季度复盘里的一句》
来源：https://notes.example.com/q3?utm_source=chat
选段：先写结论，再补证据。
这次先记住：下周评审只带这一句。
和你现在的关系：正在准备周三的评审。
下次回看：2026-10-16
`;

const noteCard = `已收下 · 还有 3 次回看

《周三评审纪要》
来源：周三评审纪要
选段：先写结论，再补证据。
这次先记住：下周评审只带这一句。
下次回看：2026-10-16
`;

function stringsIn(value, depth = 0) {
  if (typeof value === 'string') return [value];
  if (!value || typeof value !== 'object' || depth > 2) return [];
  return Object.values(value).flatMap((item) => stringsIn(item, depth + 1));
}

function asCollections(value) {
  if (!value) return null;
  if (Array.isArray(value)) return { records: value, archived: [] };
  if (Array.isArray(value.records) || Array.isArray(value.archived)) {
    return { records: value.records ?? [], archived: value.archived ?? [] };
  }
  return null;
}

function looksLikeRecord(item) {
  return Boolean(item) && typeof item === 'object' && (
    typeof item.title === 'string' || typeof item.url === 'string' || typeof item.normalizedUrl === 'string'
  );
}

function tryParse(text) {
  const hits = [];
  for (const [name, fn] of Object.entries(domain)) {
    if (typeof fn !== 'function' || name === 'recordsToMarkdown') continue;
    try {
      const parsed = asCollections(fn(text));
      if (parsed && [...parsed.records, ...parsed.archived].some(looksLikeRecord)) {
        hits.push({ name, parsed });
      }
    } catch {}
  }
  return hits;
}

const roundTrip = tryParse(markdown);
const skill = tryParse(skillCard);
const note = tryParse(noteCard);
const day = (value) => new Intl.DateTimeFormat('en-CA', {
  year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Shanghai',
}).format(new Date(value));

console.log(JSON.stringify({
  exports: Object.keys(domain),
  roundTrip: roundTrip.map(({ name, parsed }) => ({
    name,
    active: parsed.records.map((item) => ({
      title: item.title, url: item.url, normalizedUrl: item.normalizedUrl,
      stage: item.stage, nextReviewAt: item.nextReviewAt, excerpt: item.excerpt,
      encounters: (item.encounters ?? []).map((event) => event.type),
    })),
    archived: parsed.archived.map((item) => ({ title: item.title, stage: item.stage })),
  })),
  skill: skill.map(({ name, parsed }) => ({
    name,
    items: [...parsed.records, ...parsed.archived].map((item) => ({
      bucket: parsed.records.includes(item) ? 'records' : 'archived',
      title: item.title, normalizedUrl: item.normalizedUrl, stage: item.stage,
      excerpt: item.excerpt,
      nextDay: Number.isFinite(item.nextReviewAt) ? day(item.nextReviewAt) : null,
      strings: stringsIn(item),
    })),
  })),
  note: note.map(({ name, parsed }) => ({
    name,
    items: [...parsed.records, ...parsed.archived].map((item) => ({
      title: item.title, url: item.url, normalizedUrl: item.normalizedUrl, stage: item.stage,
      strings: stringsIn(item),
    })),
  })),
}, null, 2));
```

再查界面和安全边界：

```bash
rg -n "host_permissions|javascript:|file:|data:" extension/manifest.json extension/service-worker.mjs extension/library.js
rg -n "打卡|逾期|掌握度" extension studio skills -g '!*.md' -g '!docs/**'
rg -n "import-records|text/markdown|\.md|这次先记住" extension/library.js extension/library.html extension/pet.js extension/sidepanel.mjs
cmp core/domain.mjs extension/domain.mjs && echo DOMAIN_SYNC_OK
```

第 1 条看脚本的 `roundTrip`。期望活动记录阶段为 2，`nextReviewAt` 等于推进后的原值，选段为「先写结论」，足迹类型顺序含 `saved` 然后 `used`，归档标题「已经放好的一篇」只出现在 `archived`。再把解析结果按现有 `mergeByKey` 或导入消息合并一次，条数不增加。`normalizedUrl` 为 `https://notes.example.com/q3`。

第 2 条看 `skill`。标题为「季度复盘里的一句」，选段为「先写结论，再补证据。」，阶段为 1，`nextDay` 为 `2026-10-16`，字符串字段里同时有「下周评审只带这一句。」和「正在准备周三的评审。」。`normalizedUrl` 不保留 `utm_source`。

第 3 条用脚本找到存放「下周评审只带这一句。」的字段名，再读 `extension/pet.js` 的到期卡片模板、`extension/sidepanel.mjs` 的渲染函数、`extension/library.js` 的 `renderToday`。该字段的文本节点要先于选段节点。用 `tests/pet.test.mjs` 已有的页面替身加载宠物，传入一条到期记录，确认卡片文本里这句话出现在选段之前；侧边栏用 `tests/sidepanel.test.mjs` 的 `loadPanel` 做同样的事。收藏库搜索：把这句话放进记录、选段留空，`matchesRecordQuery` 或收藏库过滤结果仍能命中。

第 4 条看 `note`。解析结果有一条标题为「周三评审纪要」的记录，且它能被 `isDue` / `selectNextDue` 在下次回看时间到达后选中。再读打开记录的路径（`service-worker.mjs` 的 `open-record` 以及收藏库、宠物上的打开按钮）。笔记的打开目标是扩展页面，URL 的协议不是 `file:`、`javascript:`、`data:`。把同一张卡片解析两次再合并，仍然一条。

第 5 条先看 `npm test` 里这些既有用例是否仍通过：异常旧记录留存、`file://` 不能打开、无效备份整批拒绝、五千条上限、字段过长不覆盖、旧备份不把「不再需要」复活。再准备一份含 `file:///old-note` 和一条有效 `https` 记录的 JSON，走现有 `import-records`。`file://` 条目留在无法显示的原始数据里，有效记录按较新的 `updatedAt` 合并。随后故意喂一份坏 Markdown；若实现是整批拒绝，原收藏条数不变。

第 6 条看 `extension/manifest.json` 的 `permissions` 是否仍正好是 `activeTab`、`alarms`、`notifications`、`scripting`、`sidePanel`、`storage`、`unlimitedStorage`，且没有 `host_permissions`。`cmp` 必须打印 `DOMAIN_SYNC_OK`。上面的 `rg` 在扩展、创空间和技能的用户可见字符串里不命中「打卡」「逾期」「掌握度」。`extension/*.js` 与 `extension/*.mjs` 里不新增把记录发往外部的 `fetch`。

第 7 条确认 `npm test` 与 `npm run check` 的退出码为 0，并打开新增测试，核对有行为断言覆盖往返、技能卡片和「笔记不能当网页打开」。只给源码文本做快照、或断言恒为真，不算覆盖。收藏库页面上要有能选中 `.md` 的导入控件，旁边的句子描述的是已经实现的行为。

页面核对用扩展的本地页面即可，不依赖商店账号：用「加载解压缩的扩展」装入 `extension/`，打开选项页「我的收藏」。导出一份带「这次先记住」的收藏为 Markdown，再导入，确认列表不新增重复项，到期卡片先显示那句话。没有浏览器时，以第 3 条的 Node 替身和第 7 条的测试为准，并在评分备注里写上「未做真实浏览器点击」。

### 每条评分细则

第 1 条，Markdown 往返。

- S：阶段、`nextReviewAt`、选段、足迹类型顺序、归档分区都与导出前一致；再导入一次不新增记录；追踪参数不回到身份里。
- A：上述字段里有一个非时间字段丢失，阶段、归档分区和去重仍然正确。
- B：活动记录能导回，归档被放进活动列表，或下次回看被重算成「导入时刻加间隔」。
- 不合格：没有可调用的解析结果，导入后同一网页变成两条，或现有 `recordsToMarkdown` 的选段与足迹从导出里消失。

第 2 条，技能记录卡。

- S：标题、去追踪参数后的网址、选段、两句原话、阶段 1、北京时间 2026-10-16 都在。技能文件可以改得更稳，但这张按原说明写成的卡片仍能导入。
- A：关系句丢失，其余都在。
- B：卡片能导入，但「这次先记住」被并进选段，或下一次日期被忽略、改成导入后一天。
- 不合格：这张卡片没有解析结果，或 `normalizedUrl` 仍带着 `utm_source`，导致和已有收藏分成两条。

第 3 条，回看时先看见那句话。

- S：宠物、侧边栏、今天看一条三处都先显示「这次先记住」，选段仍在；空句子不占一块；搜索能命中这句话。
- A：三处都能看见，但选段排在这句话前面，或者搜索还不能命中。
- B：只有一处或两处能看见。
- 不合格：三处都看不见，或这句话替换掉了选段。

第 4 条，无链接笔记。

- S：笔记进入回看节奏，到期后能被选为「今天这一条」，在扩展页面里读到正文；导入两次仍是一条；打开路径不使用 `file:`、`javascript:`、`data:`。
- A：笔记能到期并被选中，打开时回到收藏库，正文要再点一次才出现。
- B：笔记能存下来，但不会到期，或不能从「今天看一条」到达。
- 不合格：笔记被丢掉；打开动作导航到 `file:`、`javascript:` 或 `data:`；为了读本地文件新增了 `host_permissions`。

第 5 条，旧备份。

- S：第 5 条列出的既有测试通过；`file:///old-note` 仍留在无法显示的原始数据中；坏 Markdown 不覆盖现有收藏；JSON 与 Markdown 导入同一网页时保留较新的进度。
- A：既有测试通过，仅在 `updatedAt` 完全相同的冲突上保留了任意一边。
- B：既有测试通过，但坏 Markdown 或部分失败的混合导入改写了原收藏。
- 不合格：既有导入测试失败，或 `file://` 旧记录变成可打开的标签页。

第 6 条，权限、文案与单一领域规则。

- S：权限列表未变，没有 `host_permissions`，两份领域文件字节相同，三处用户可见文案没有新增禁词，收藏内容没有新的外发请求。
- A：权限和领域文件合格，有一处次要文案出现禁词。
- B：领域文件已经分叉，或版本号只改了一处导致 `npm test` 里的版本一致性失败。
- 不合格：新增 `host_permissions` 或全站访问；`npm test` 中领域文件字节一致性失败且没有同步；扩展把记录发往外部网络。

第 7 条，测试与入口。

- S：`npm test` 与 `npm run check` 通过；新增测试在丢足迹、丢「这次先记住」、笔记被当网页打开时会失败；收藏库有可用的 Markdown 导入入口，说明与行为一致。
- A：命令通过，测试覆盖了往返和「这次先记住」，还没覆盖笔记协议；导入入口可用。
- B：命令通过，新增测试只比较源码文本；或者解析只存在于领域层，收藏库仍然只能选 JSON。
- 不合格：`npm test` 或 `npm run check` 失败；没有新增测试；页面写着可以导入 Markdown，控件却只接受 JSON 并忽略 `.md`。

## 7. 上传前要剔除的文件

密钥扫描范围是除 `.git/`、`node_modules/` 以外的全部文件。没有发现 `.env`、私钥、`.pem`、令牌文件、云厂商 Access Key，或写进源码的密码。`.git/config` 的远程地址是 `https://github.com/endtree-FDE/yidian`，里面没有令牌。打包时仍要排除 `.git/` 和 `node_modules/`。本机凭据若只存在于环境变量，不会跟着工作区文件走，但会跟着 `.git` 走。

仓库当前是私有库。下面这些内容一旦打进众测包，就会把个人账号交给模型和评测人员。

必须剔除或改写：

| 文件 | 原因 |
| --- | --- |
| `studio/xiaohongshu-endtree.jpg` | 个人小红书二维码，画面含头像和昵称「终树endtree」 |
| `studio/contact.html` | 小红书号 `1052658250`、上述二维码、GitHub 数字身份 `2487238628`、腾讯文档反馈表 `https://docs.qq.com/form/page/DZE9LR0hwVkRyemZn` |
| `docs/release/publishing-boundary.md` | 写明个人发布目标：`2487238628/yidian`、`2487238628.github.io/yidian`、ModelScope `endTree26/yidian` |
| `tests/studio.test.mjs` | 断言了 `github.com/2487238628`、小红书号 `1052658250` 和二维码文件。只删资源不改测试的话，`npm test` 会失败 |
| `docs/g12-task-draft.md` | 本文件含评测标准和检查脚本，不能进入模型仓库 |

建议改写后再上传。它们不是密钥，但指向同一个人的外部账号。仓库若保持私有，这些链接就还不是公开资料：

| 文件 | 内容 |
| --- | --- |
| `studio/index.html` | ModelScope 用户 `endTree26`，Edge 扩展 ID `mdpemepjnajchhlagfkpggenllebeacd` |
| `README.md` | 同一 Edge 扩展 ID 与商店链接 |
| `docs/release/yidian-1.0.2-update-article.md` | GitHub 数字身份与 ModelScope 用户 |
| `docs/release/modelscope-publication.md` | ModelScope 创空间地址 |
| `docs/release/yidian-1.3.4.md` | Edge 扩展 ID、公开 CRX 的 SHA256。哈希是发布核对值，不是密钥 |
| `docs/brand/20260727-105901-yidian-contact-community-v0-4/` | 作者公开名「终树 endTree」的确认过程 |

可以留下，已核对不是个人数据：

- `studio/edge-review-sample.json` 是 `example.com` 上的审核样本。
- `docs/release/edge-store-assets/` 抽看了 `1.3.4-01-save.png` 与 `1.3.4-03-library.png`，内容是 example.com 的产品界面。
- `extension/fonts/` 是站酷小薇体的字体文件和 OFL 许可文本。
- 品牌配图 `docs/brand/20260729-212534-yidian-redskill-v1-0/visuals*/` 体积大，任务用不到。文件名是宣传图。上传前人工翻一遍即可，不必当作密钥删除。

脱敏会改动 `studio/contact.html` 和 `tests/studio.test.mjs`。那一步单独做，不要和本调研提交混在一起。脱敏后再跑一次 `npm test`，确认联系页断言已经跟着新文案改完。

## 8. 投稿时的材料边界

模型任务包：脱敏后的仓库，不含本文件，不含 `.git/` 与 `node_modules/`。

验收人员另持：本文件、第 6 节的检查脚本，以及五个模型交回的工作区。

首轮只发送第 6 节的 Prompt。后续若模型提问，回答产品边界即可，不补充函数名、文件清单或评分档。
