<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { PhMapPinLine } from '@phosphor-icons/vue'

const step = ref(0)
const messages = ['正在理解你的漫游偏好', '在地图上寻找合适地点', '核对天气、距离与开放信息', '把沿途地点串成一条路线']
const message = computed(() => messages[step.value % messages.length])
let timer: number | undefined

onMounted(() => { timer = window.setInterval(() => { step.value += 1 }, 1900) })
onUnmounted(() => { if (timer !== undefined) window.clearInterval(timer) })
</script>

<template>
  <div class="searching-reply" role="status" aria-live="polite">
    <span class="reply-pin"><PhMapPinLine :size="21" /></span>
    <div class="mini-map">
      <svg viewBox="0 0 420 180" preserveAspectRatio="none" aria-hidden="true">
        <path class="street main" d="M-10 142 C70 108 116 133 173 92 S286 70 430 19"/>
        <path class="street" d="M28 8 C74 57 98 86 106 188"/>
        <path class="street" d="M217 -10 C222 42 253 101 288 190"/>
        <path class="street" d="M-10 54 C81 43 132 49 202 75 S337 127 435 116"/>
        <path class="route" d="M42 137 C106 110 131 128 175 93 S282 72 374 35"/>
        <circle cx="42" cy="137" r="7"/><circle cx="175" cy="93" r="7"/><circle cx="374" cy="35" r="7"/>
      </svg>
      <span class="map-label label-a">街巷</span><span class="map-label label-b">公园</span><span class="map-label label-c">展馆</span>
      <div class="magnifier"><span /></div>
      <i class="scan-dot dot-a"/><i class="scan-dot dot-b"/><i class="scan-dot dot-c"/>
    </div>
    <div class="search-copy"><small>Agent 正在检索</small><strong>{{ message }}</strong><span><i/><i/><i/></span></div>
  </div>
</template>

<style scoped>
.searching-reply { width:min(680px,88%);margin:12px auto 30px 5%;padding:16px 18px 16px;position:relative;border:1px solid rgba(138,114,102,.18);border-radius:6px 19px 8px 16px;background:#fffdf6;box-shadow:0 11px 24px rgba(86,67,56,.1);transform:rotate(-.25deg) }.searching-reply::before{content:'';position:absolute;top:-9px;left:72px;width:80px;height:22px;background:rgba(200,241,122,.45);transform:rotate(-2deg)}.reply-pin{position:absolute;right:13px;top:8px;color:rgba(151,68,0,.28);font-size:23px}
.mini-map{height:168px;position:relative;overflow:hidden;border-radius:4px 14px 4px 14px;background-color:#f1eee5;background-image:radial-gradient(rgba(138,114,102,.22) .6px,transparent .6px);background-size:13px 13px}.mini-map svg{position:absolute;inset:0;width:100%;height:100%}.street{fill:none;stroke:#ddc1b3;stroke-width:8;opacity:.48}.street.main{stroke-width:13;opacity:.62}.route{fill:none;stroke:#496800;stroke-width:4;stroke-linecap:round;stroke-dasharray:8 7;animation:routeFlow 1.2s linear infinite}.mini-map circle{fill:#974400;stroke:#fff;stroke-width:4}.map-label{position:absolute;padding:3px 7px;background:rgba(255,255,255,.72);color:#8a7266;border-radius:4px;font-size:8px}.label-a{left:18%;top:17%}.label-b{left:56%;top:58%}.label-c{right:8%;top:21%}
.magnifier{position:absolute;left:8%;top:17%;width:68px;height:68px;border:7px solid #974400;border-radius:50%;box-shadow:0 6px 17px rgba(86,67,56,.22),inset 0 0 0 3px rgba(255,255,255,.8);background:rgba(255,255,255,.16);animation:mapSearch 5.7s ease-in-out infinite}.magnifier::after{content:'';position:absolute;width:39px;height:9px;right:-31px;bottom:-15px;border-radius:999px;background:#974400;transform:rotate(47deg);transform-origin:left center}.magnifier span{position:absolute;inset:9px;border:1px dashed rgba(151,68,0,.32);border-radius:50%;animation:spin 3s linear infinite}.scan-dot{position:absolute;width:11px;height:11px;border-radius:50%;background:#c8f17a;border:2px solid #496800;opacity:0;animation:found 5.7s infinite}.dot-a{left:27%;top:62%;animation-delay:.6s}.dot-b{left:58%;top:33%;animation-delay:2.3s}.dot-c{right:14%;bottom:30%;animation-delay:4s}
.search-copy{display:flex;align-items:center;gap:13px;padding:13px 5px 1px}.search-copy small{color:#974400;font-size:8px;font-weight:800;letter-spacing:.16em}.search-copy strong{color:#564338;font:600 14px var(--font-display)}.search-copy>span{display:flex;gap:4px;margin-left:auto}.search-copy i{width:5px;height:5px;border-radius:50%;background:#974400;animation:pulse-dot 1.1s infinite}.search-copy i:nth-child(2){animation-delay:.18s}.search-copy i:nth-child(3){animation-delay:.36s}
@keyframes mapSearch{0%,100%{left:8%;top:17%;transform:rotate(-5deg)}30%{left:39%;top:46%;transform:rotate(4deg)}63%{left:69%;top:12%;transform:rotate(-2deg)}82%{left:51%;top:27%;transform:rotate(5deg)}}@keyframes found{0%,12%,100%{opacity:0;transform:scale(.3)}18%,62%{opacity:1;transform:scale(1);box-shadow:0 0 0 7px rgba(155,63,33,.2)}}@keyframes routeFlow{to{stroke-dashoffset:-30}}
@media(prefers-reduced-motion:reduce){.magnifier{animation:none;left:45%;top:28%}.route,.scan-dot,.search-copy i{animation:none}.scan-dot{opacity:1}}
@media(max-width:650px){.searching-reply{width:94%;margin-left:0}.mini-map{height:135px}.search-copy{align-items:flex-start;flex-direction:column;gap:3px}.search-copy>span{position:absolute;right:23px;bottom:20px}}
.searching-reply{border-radius:var(--radius);transform:none;border-color:var(--border-subtle)}
.searching-reply::before{background:rgba(155,63,33,.14)}
.reply-pin{display:grid}.route{stroke:var(--primary)}.mini-map circle{fill:var(--primary)}
.scan-dot{background:var(--primary-fixed);border-color:var(--primary)}
.map-label{font-size:11px}.search-copy small{font-size:12px;letter-spacing:0}.search-copy strong{font-size:15px}
</style>
