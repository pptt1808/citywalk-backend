# CityWalk Pulse Android

原生 Kotlin + Jetpack Compose 客户端。网页负责路线规划、收藏和手账编辑；Android 只负责路线执行、持续定位、途中图文、实时改路以及把原始记录同步回网页。

## 本机模拟器联调

先在仓库根目录启动后端：

```powershell
npm run dev
```

如果后端运行在 WSL，而 Android 模拟器运行在 Windows，再开一个终端并仍从仓库根目录执行：

```powershell
node android\scripts\wsl-port-proxy.cjs
adb reverse tcp:3000 tcp:3000
set GRADLE_USER_HOME=%CD%\android\.gradle-windows
android\gradlew.bat -p android testDebugUnitTest assembleDebug assembleRelease
adb install android\app\build\outputs\apk\release\app-release.apk
```

第一条命令用于后端运行在 WSL 的情况：它在 Windows `127.0.0.1:3000` 建立一个普通用户权限的 TCP 转发，不需要管理员权限。若后端本来就运行在 Windows，可跳过。

应用默认访问 `http://127.0.0.1:3000`。真机无法使用 `adb reverse` 时，在“我的 → 联调服务地址”填写电脑局域网地址，例如 `http://192.168.1.10:3000`。

高德 Android Key 通过环境变量 `AMAP_ANDROID_KEY` 或已忽略的 `android/local.properties` 同名字段注入，源码中不保存具体值。移动端使用高德原生 3D 底图、步行道路算路、编号站点、实时位置和行走轨迹；未配置 Key、路线缺少坐标或用户暂不同意高德隐私政策时，才回退到 `RouteCanvas` 简图。

当前地图 SDK 固定为 9.8.3，搜索 SDK 为 9.7.1：这是为了保留 `x86_64` 原生库供本机 Android 模拟器使用，同时也包含 ARM 真机库。高德 10.x 及以上合包不再提供 x86_64，装到当前模拟器会因 JNI 无法加载而黑屏。

Android Key 必须同时匹配包名和 APK 签名。当前高德 Key 绑定的是 Release SHA-1，因此模拟器应安装正式签名的 `app-release.apk`；若要使用普通 Debug APK，还需在高德控制台补充 Debug SHA-1。第一次打开地图时，应用会先展示高德地图 SDK 用途和第三方隐私政策，取得用户明确同意后才创建 `MapView`。

## 发布签名

首次配置发布证书时，从仓库根目录运行 `npm run signing:generate`。脚本会生成 `android/keystore/citywalk-pulse-release.jks` 和包含随机密码的 `android/keystore.properties`，Gradle Release 构建会自动读取。两者都已被 Git 忽略，必须一起离线备份；正式发布后不要重新生成或替换。

## 移动端职责

- “路线”：领取网页规划后发送的路线，或从收藏中直接开始。
- “漫步”：前台服务持续定位，自动判断到达、添加原图和文字、跳过站点、动态改路及撤销。
- 结束路线：同步轨迹与沿途图文，不在手机端生成或展示手账；离线时先保存在本机，联网后由 WorkManager 同步。
- “我的”：登录状态、同步状态和真机联调地址。

网页端保留规划、收藏和全部手账能力，不再承担实时定位和随身记录。跨端通过 `/api/walks/handoff`、`/api/walks/active`、`/api/walks/events` 和 `/api/journals` 同步，并按登录用户隔离。
