const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..");
const androidRoot = path.join(projectRoot, "android");
const signingDir = path.join(androidRoot, "keystore");
const keystorePath = path.join(signingDir, "citywalk-pulse-release.jks");
const propertiesPath = path.join(androidRoot, "keystore.properties");
const alias = "citywalk-pulse";

if (fs.existsSync(keystorePath) || fs.existsSync(propertiesPath)) {
  console.error("发布证书或配置已经存在。为防止覆盖应用身份，生成操作已停止。");
  process.exit(2);
}

const password = crypto.randomBytes(30).toString("base64url");
const passwordEnvName = "CITYWALK_RELEASE_KEY_PASSWORD";
const childEnv = { ...process.env, [passwordEnvName]: password };
const keytool = process.env.JAVA_HOME
  ? path.join(process.env.JAVA_HOME, "bin", process.platform === "win32" ? "keytool.exe" : "keytool")
  : "keytool";

fs.mkdirSync(signingDir, { recursive: true });

const generated = spawnSync(keytool, [
  "-genkeypair",
  "-v",
  "-keystore", keystorePath,
  "-storetype", "PKCS12",
  "-alias", alias,
  "-keyalg", "RSA",
  "-keysize", "2048",
  "-sigalg", "SHA256withRSA",
  "-validity", "10000",
  "-dname", "CN=CityWalk Pulse, OU=Mobile, O=CityWalk Pulse, L=Nanjing, ST=Jiangsu, C=CN",
  `-storepass:env`, passwordEnvName,
  `-keypass:env`, passwordEnvName
], { encoding: "utf8", env: childEnv });

if (generated.status !== 0) {
  console.error(generated.stderr || generated.stdout || "keytool 生成失败");
  if (fs.existsSync(keystorePath)) fs.rmSync(keystorePath);
  process.exit(generated.status || 1);
}

fs.writeFileSync(propertiesPath, [
  "# 本文件包含发布签名密码：不得提交 Git，必须与 JKS 一起离线备份。",
  "storeFile=keystore/citywalk-pulse-release.jks",
  `storePassword=${password}`,
  `keyAlias=${alias}`,
  `keyPassword=${password}`,
  ""
].join("\n"), { mode: 0o600 });
fs.chmodSync(keystorePath, 0o600);

const report = spawnSync(keytool, [
  "-list",
  "-v",
  "-keystore", keystorePath,
  "-alias", alias,
  `-storepass:env`, passwordEnvName
], { encoding: "utf8", env: childEnv });

if (report.status !== 0) {
  console.error(report.stderr || report.stdout || "无法读取发布证书");
  process.exit(report.status || 1);
}

const combined = `${report.stdout}\n${report.stderr}`;
const sha1 = combined.match(/SHA1:\s*([0-9A-F:]+)/i)?.[1];
console.log("Android Release 证书已生成并写入本机配置。");
console.log(`证书：${path.relative(projectRoot, keystorePath)}`);
console.log(`密码配置：${path.relative(projectRoot, propertiesPath)}`);
if (sha1) console.log(`Release SHA-1：${sha1.toUpperCase()}`);
else console.log("证书已生成；请通过 Gradle signingReport 查看 SHA-1。");
