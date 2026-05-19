# 云端部署说明

推荐先用 Render 部署。新版已经支持云端账号同步：登录用户的数据会保存到 PostgreSQL 数据库，手机和电脑登录同一个账号即可看到同一份数据。

## 你需要准备

1. 一个 GitHub 账号。
2. 一个 Render 账号。
3. 一个 PostgreSQL 数据库连接地址，也就是 Render 数据库页面里的 `Internal Database URL`。

## 部署到 Render

1. 把这个文件夹上传到一个 GitHub 仓库。
2. 打开 Render，选择 `New` -> `Blueprint`。
3. 连接刚才的 GitHub 仓库。
4. Render 会读取 `render.yaml`。
5. 部署完成后，Render 会给你一个网址，例如：

```text
https://stock-practice-lab.onrender.com
```

以后手机、电脑都打开这个网址即可，不需要同一个 Wi-Fi，也不需要你的电脑一直开着。

## 开启跨设备账号同步

1. 在 Render 新建一个 PostgreSQL 数据库。
2. 打开这个数据库页面，复制 `Internal Database URL`。
3. 打开你的 Web Service -> `Environment`。
4. 添加环境变量：

```text
DATABASE_URL=刚才复制的 Internal Database URL
```

5. 保存后点 `Manual Deploy` -> `Deploy latest commit`。

完成后，第一次使用点“注册新账户”，只需要手机号/邮箱 + 密码，不需要邀请码。之后手机和电脑登录同一个账号，模拟资金、持仓、订单、复盘会同步。

## 手机上像 App 一样使用

### iPhone

1. 用 Safari 打开云端网址。
2. 点分享按钮。
3. 选择“添加到主屏幕”。

### Android

1. 用 Chrome 打开云端网址。
2. 点右上角菜单。
3. 选择“添加到主屏幕”或“安装应用”。

## 注意

- Render 免费服务可能会休眠，第一次打开可能要等几十秒。
- 如果没有设置 `DATABASE_URL`，系统会退回临时文件存储，重新部署后可能丢数据；要跨设备长期使用，一定要配置 PostgreSQL。
- 免费行情可能延迟或失败，失败时系统会自动切换到仿真行情。
- 这是模拟训练工具，不构成投资建议。
