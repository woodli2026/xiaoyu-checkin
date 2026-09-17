# 发布到 GitHub

> 生成时间：2026-09-17

## 当前状态（本地已就绪）

| 项 | 状态 |
|---|---|
| Git 仓库初始化 | ✅ 已完成 |
| 首次提交 | ✅ `7ce1e9f`，213 个文件 / 11569 行 |
| 分支 | `master`（推送时会改名为 `main`） |
| 远程关联 | ❌ 待你建好仓库后关联 |
| `.workbuddy/`（项目记忆） | ✅ 已排除，不入库 |
| `project.private.config.json` | ✅ 已排除（个人编译配置，因人而异） |
| `node_modules/` | ✅ 已排除 |

**你只需做两件事**：① 在 GitHub 建一个私有仓库；② 复制第 3 步的命令推送。

---

## 第 1 步：在 GitHub 建私有仓库

1. 打开 <https://github.com/new>
2. **Repository name**：`xiaoyu-checkin`
3. **Visibility**：选 **Private**（私有）
4. ⚠️ **不要勾选** "Add a README file" / ".gitignore" / "license" —— 仓库必须为空，否则首次推送会冲突
5. 点 **Create repository**
6. 建好后把仓库地址复制给我（形如 `https://github.com/你的用户名/xiaoyu-checkin.git`）

> 本机没有 `gh` CLI，我无法代建仓库，这一步只能你在网页上做。

---

## 第 2 步：配置推送凭据（二选一）

### 方案 A · HTTPS + Token（推荐，最省事）

1. GitHub → 右上角头像 → **Settings** → **Developer settings** → **Personal access tokens** → **Tokens (classic)** → **Generate new token**
2. 勾选 **`repo`**（其余默认），生成后**立刻复制**（只显示一次）
3. 在本机执行一次，让 git 记住凭据：

```bash
git credential approve <<'EOF'
protocol=https
host=github.com
username=你的GitHub用户名
password=刚才生成的token
EOF
```

### 方案 B · SSH

本机 SSH 密钥是 `id_ed25519_slacking`（**非默认文件名**），git 不会自动使用它，必须先写 `~/.ssh/config`：

```
Host github.com
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_ed25519_slacking
```

然后确认公钥已加到 GitHub（Settings → SSH and GPG keys）：

```bash
cat ~/.ssh/id_ed25519_slacking.pub
ssh -T git@github.com      # 看到 "Hi 用户名!" 即配置成功
```

---

## 第 3 步：推送（复制即用）

**HTTPS 方案**：

```bash
cd /d/MyWorkspace/xiaoyu-checkin
git remote add origin https://github.com/你的用户名/xiaoyu-checkin.git
git branch -M main
git push -u origin main
```

**SSH 方案**：

```bash
cd /d/MyWorkspace/xiaoyu-checkin
git remote add origin git@github.com:你的用户名/xiaoyu-checkin.git
git branch -M main
git push -u origin main
```

> 若已关联过 remote，把 `add` 换成 `set-url`：
> `git remote set-url origin <新地址>`

---

## 第 4 步：验证

```bash
git remote -v                 # 确认地址正确
git log --oneline -1          # 确认提交在本地
git status                    # 应为 "nothing to commit, working tree clean"
```

推送成功后打开仓库页面，应能看到 213 个文件、`README-小程序.md` 为首页说明。

---

## ⚠️ 两个必须知道的注意点

### 1. README 里有真实的云函数密钥

`README-小程序.md` §3.4 明文写着两个 64 位随机密钥：

```
XY_TOKEN_SECRET=37ff...4523
XY_PIN_SALT=46a8...6660
```

拿到 `XY_TOKEN_SECRET` 的人可以**伪造家长令牌、越权读写数据**。

- 现在是**私有仓库**，风险可控；
- **若将来把仓库转为公开，必须先替换这两个值**（重新生成并写入云函数环境变量），否则等于把密钥交出去。

### 2. 云函数密钥要成对环境变更

密钥不是只改一处。按项目约定，改动涉及 4 类镜像：真源 `cloudfunctions/lib/` → 11 个函数副本 → 本地兜底 → 前端文案，且改完必须 `npm run sync`。详见 `README-小程序.md` §3.4。

---

## 附：常见失误

| 症状 | 原因 | 处理 |
|---|---|---|
| `src refspec main does not match any` | 分支名还是 master | 先 `git branch -M main` 再 push |
| `failed to push some refs` | GitHub 仓库非空（建了 README） | 先 `git pull origin main --allow-unrelated-histories` 再 push |
| `Permission denied (publickey)` | SSH 密钥名非默认、未配 config | 按方案 B 写 `~/.ssh/config` |
| `Support for password authentication was removed` | 用账号密码推 HTTPS | 必须用 Token（方案 A） |
