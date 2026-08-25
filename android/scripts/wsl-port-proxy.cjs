const net = require('node:net')
const { execFileSync } = require('node:child_process')

const listenPort = Number(process.env.CITYWALK_PROXY_PORT || 3000)
const targetPort = Number(process.env.CITYWALK_BACKEND_PORT || 3000)
const targetHost = process.env.CITYWALK_WSL_IP || execFileSync('wsl.exe', ['hostname', '-I'], { encoding: 'utf8' })
  .trim().split(/\s+/)[0]

const server = net.createServer(client => {
  const upstream = net.connect({ host: targetHost, port: targetPort })
  client.pipe(upstream)
  upstream.pipe(client)
  const close = () => {
    if (!client.destroyed) client.destroy()
    if (!upstream.destroyed) upstream.destroy()
  }
  client.on('error', close)
  upstream.on('error', close)
  client.on('close', close)
  upstream.on('close', close)
})

server.on('error', error => {
  if (error.code === 'EADDRINUSE') {
    console.error(`[CityWalk Android] localhost:${listenPort} 已被占用；若后端可访问可忽略，否则结束占用进程后重试。`)
  } else console.error(error)
  process.exitCode = 1
})

server.listen(listenPort, '127.0.0.1', () => {
  console.log(`[CityWalk Android] 127.0.0.1:${listenPort} -> ${targetHost}:${targetPort}`)
})

function shutdown() { server.close(() => process.exit(0)) }
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
