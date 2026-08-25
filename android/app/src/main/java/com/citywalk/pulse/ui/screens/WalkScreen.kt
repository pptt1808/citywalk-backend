@file:OptIn(
    androidx.compose.material3.ExperimentalMaterial3Api::class,
    androidx.compose.foundation.layout.ExperimentalLayoutApi::class
)

package com.citywalk.pulse.ui.screens

import android.Manifest
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AddAPhoto
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.CameraAlt
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.CloudDone
import androidx.compose.material.icons.outlined.DirectionsWalk
import androidx.compose.material.icons.outlined.EditLocationAlt
import androidx.compose.material.icons.outlined.Explore
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.LocationOff
import androidx.compose.material.icons.outlined.LocationOn
import androidx.compose.material.icons.outlined.MoreTime
import androidx.compose.material.icons.outlined.Restaurant
import androidx.compose.material.icons.outlined.SkipNext
import androidx.compose.material.icons.outlined.Undo
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import coil.compose.AsyncImage
import com.citywalk.pulse.data.ActiveWalk
import com.citywalk.pulse.data.SyncState
import com.citywalk.pulse.ui.components.RouteMap
import com.citywalk.pulse.ui.theme.Moss
import com.citywalk.pulse.ui.theme.MossSoft
import com.citywalk.pulse.ui.theme.Terracotta
import kotlinx.coroutines.delay
import java.io.File
import java.time.Duration
import java.time.Instant

@Composable
fun WalkScreen(
    walk: ActiveWalk?, syncState: SyncState, busy: Boolean,
    onRequestTracking: () -> Unit, onStopTracking: () -> Unit,
    onMarkNext: (String) -> Unit, onAddMoment: (String, List<Uri>, () -> Unit) -> Unit,
    onAdjust: (String, Int?, String?) -> Unit, onUndo: () -> Unit, onFinish: (() -> Unit) -> Unit,
    onGoRoutes: () -> Unit
) {
    if (walk == null) {
        Box(Modifier.fillMaxSize().padding(30.dp), contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Surface(shape = CircleShape, color = MaterialTheme.colorScheme.primaryContainer) {
                    Icon(Icons.Outlined.DirectionsWalk, null, Modifier.padding(18.dp).size(34.dp), tint = Terracotta)
                }
                Text("还没有开始漫步", style = MaterialTheme.typography.headlineSmall, modifier = Modifier.padding(top = 18.dp))
                Text("从收藏路线或网页接力路线中选择一条。", color = MaterialTheme.colorScheme.onSurfaceVariant)
                Button(onClick = onGoRoutes, modifier = Modifier.padding(top = 18.dp)) { Text("去选择路线") }
            }
        }
        return
    }

    LaunchedEffect(walk.id) { onRequestTracking() }
    var showRecord by remember { mutableStateOf(false) }
    var showAdjust by remember { mutableStateOf(false) }
    var showFinish by remember { mutableStateOf(false) }
    var nowMs by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(walk.id) { while (true) { delay(1000); nowMs = System.currentTimeMillis() } }
    val elapsed = remember(walk.startedAt, walk.pausedMs, nowMs) {
        Duration.ofMillis((nowMs - Instant.parse(walk.startedAt).toEpochMilli() - walk.pausedMs).coerceAtLeast(0))
    }
    val finished = walk.stopProgress.count { it.status == "visited" || it.status == "skipped" }
    val context = LocalContext.current

    LazyColumn(
        Modifier.fillMaxSize(), contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 112.dp),
        verticalArrangement = Arrangement.spacedBy(0.dp)
    ) {
        item {
            Box(Modifier.fillMaxWidth().height(350.dp).padding(horizontal = 14.dp, vertical = 10.dp)) {
                RouteMap(walk.route, walk, Modifier.fillMaxSize())
                Surface(
                    modifier = Modifier.align(Alignment.TopStart).padding(12.dp),
                    color = MaterialTheme.colorScheme.surface.copy(alpha = .92f), shape = RoundedCornerShape(50)
                ) {
                    Row(Modifier.padding(horizontal = 11.dp, vertical = 7.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(if (walk.currentLocation != null) Icons.Outlined.LocationOn else Icons.Outlined.LocationOff, null, Modifier.size(17.dp), tint = if (walk.currentLocation != null) Moss else Terracotta)
                        Text(if (walk.currentLocation != null) "定位记录中" else "等待定位", modifier = Modifier.padding(start = 5.dp), style = MaterialTheme.typography.labelMedium)
                    }
                }
                Surface(
                    modifier = Modifier.align(Alignment.TopEnd).padding(12.dp),
                    color = MaterialTheme.colorScheme.surface.copy(alpha = .92f), shape = RoundedCornerShape(50)
                ) {
                    Row(Modifier.padding(horizontal = 11.dp, vertical = 7.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Outlined.CloudDone, null, Modifier.size(17.dp), tint = if (syncState == SyncState.ERROR || syncState == SyncState.OFFLINE) Terracotta else Moss)
                        Text(syncLabel(syncState), modifier = Modifier.padding(start = 5.dp), style = MaterialTheme.typography.labelMedium)
                    }
                }
            }
        }
        item {
            Surface(
                modifier = Modifier.fillMaxWidth(), color = MaterialTheme.colorScheme.background,
                shape = RoundedCornerShape(topStart = 30.dp, topEnd = 30.dp), shadowElevation = 10.dp
            ) {
                Column(Modifier.padding(20.dp)) {
                    Row(verticalAlignment = Alignment.Top) {
                        Column(Modifier.weight(1f)) {
                            Text("LIVE WALK", color = Terracotta, fontWeight = FontWeight.Black, style = MaterialTheme.typography.labelMedium)
                            Text(walk.route.title, style = MaterialTheme.typography.headlineSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        }
                        OutlinedButton(onClick = { showFinish = true }, enabled = !busy) { Text("结束") }
                    }
                    Row(Modifier.fillMaxWidth().padding(top = 16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Metric("已走", "%02d:%02d".format(elapsed.toHours(), elapsed.toMinutesPart()), Modifier.weight(1f))
                        Metric("进度", "$finished/${walk.stopProgress.size} 站", Modifier.weight(1f))
                        Metric("记录", "${walk.moments.size} 条", Modifier.weight(1f))
                    }

                    walk.nextStop?.let { next ->
                        Surface(
                            modifier = Modifier.fillMaxWidth().padding(top = 18.dp),
                            color = MossSoft, shape = RoundedCornerShape(18.dp)
                        ) {
                            Column(Modifier.padding(16.dp)) {
                                Text(if (walk.stopProgress.firstOrNull { it.name == next.name }?.status == "arrived") "你已到达附近" else "下一站", color = Moss, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.labelMedium)
                                Text(next.name, style = MaterialTheme.typography.titleLarge)
                                Text(next.address ?: next.reason, maxLines = 2, overflow = TextOverflow.Ellipsis, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                                Row(Modifier.fillMaxWidth().padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    Button(onClick = { openNavigation(context, next.name, next.geoPoint) }, modifier = Modifier.weight(1f), colors = ButtonDefaults.buttonColors(containerColor = Moss)) {
                                        Icon(Icons.Outlined.Explore, null, Modifier.size(18.dp)); Text("导航", Modifier.padding(start = 5.dp))
                                    }
                                    Button(onClick = { onMarkNext("visited") }, modifier = Modifier.weight(1f)) {
                                        Icon(Icons.Outlined.Check, null, Modifier.size(18.dp)); Text("完成", Modifier.padding(start = 5.dp))
                                    }
                                    IconButton(onClick = { onMarkNext("skipped") }, modifier = Modifier.background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(12.dp))) {
                                        Icon(Icons.Outlined.SkipNext, "跳过")
                                    }
                                }
                            }
                        }
                    }

                    Row(Modifier.fillMaxWidth().padding(top = 14.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Button(
                            onClick = { showRecord = true }, enabled = !busy,
                            modifier = Modifier.weight(1.45f).height(52.dp), shape = RoundedCornerShape(15.dp)
                        ) { Icon(Icons.Outlined.AddAPhoto, null); Text("记录这一刻", Modifier.padding(start = 7.dp)) }
                        OutlinedButton(
                            onClick = { showAdjust = true }, enabled = !busy,
                            modifier = Modifier.weight(1f).height(52.dp), shape = RoundedCornerShape(15.dp)
                        ) { Icon(Icons.Outlined.EditLocationAlt, null); Text("改路线", Modifier.padding(start = 6.dp)) }
                    }
                }
            }
        }
        if (walk.routeRevisions.isNotEmpty()) item {
            Column(Modifier.padding(horizontal = 20.dp, vertical = 10.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("路线调整", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                    androidx.compose.material3.TextButton(onClick = onUndo, enabled = !busy) { Icon(Icons.Outlined.Undo, null, Modifier.size(17.dp)); Text("撤销") }
                }
                walk.routeRevisions.takeLast(2).reversed().forEach { revision ->
                    Text("${revision.reasonLabel} · ${revision.summary}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(vertical = 5.dp))
                }
            }
        }
        if (walk.moments.isNotEmpty()) item {
            Text("沿途记录", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp))
        }
        items(walk.moments.reversed(), key = { it.id }) { moment ->
            Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Surface(shape = CircleShape, color = Terracotta) { Text("${walk.moments.indexOf(moment) + 1}", color = Color.White, modifier = Modifier.padding(horizontal = 9.dp, vertical = 5.dp), fontWeight = FontWeight.Bold) }
                moment.photos.firstOrNull()?.let { photo ->
                    AsyncImage(model = photo.url, contentDescription = null, modifier = Modifier.padding(start = 10.dp).size(58.dp).clip(RoundedCornerShape(10.dp)))
                }
                Column(Modifier.padding(start = 11.dp).weight(1f)) {
                    Text(moment.stopName ?: "沿途", fontWeight = FontWeight.Bold)
                    Text(moment.note.ifBlank { "用照片记住这一刻" }, maxLines = 2, overflow = TextOverflow.Ellipsis, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            HorizontalDivider(Modifier.padding(horizontal = 20.dp), color = MaterialTheme.colorScheme.outlineVariant)
        }
    }

    if (showRecord) RecordSheet(
        busy = busy, onDismiss = { showRecord = false },
        onSave = { note, images -> onAddMoment(note, images) { showRecord = false } }
    )
    if (showAdjust) AdjustSheet(
        busy = busy, onDismiss = { showAdjust = false },
        onAdjust = { reason, minutes, custom -> onAdjust(reason, minutes, custom); showAdjust = false }
    )
    if (showFinish) AlertDialog(
        onDismissRequest = { showFinish = false },
        title = { Text("完成这段漫步？") },
        text = { Text("路线轨迹和 ${walk.moments.size} 条沿途记录会同步到网页端；之后可在网页手账中整理和排版。") },
        confirmButton = {
            Button(onClick = { onStopTracking(); onFinish { showFinish = false } }, enabled = !busy) { Text("完成并同步") }
        },
        dismissButton = { androidx.compose.material3.TextButton(onClick = { showFinish = false }) { Text("继续走") } }
    )
}

@Composable
private fun Metric(label: String, value: String, modifier: Modifier) {
    Surface(modifier, color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = .65f), shape = RoundedCornerShape(14.dp)) {
        Column(Modifier.padding(11.dp)) { Text(label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant); Text(value, fontWeight = FontWeight.Black) }
    }
}

@Composable
private fun RecordSheet(busy: Boolean, onDismiss: () -> Unit, onSave: (String, List<Uri>) -> Unit) {
    val context = LocalContext.current
    var note by remember { mutableStateOf("") }
    val images = remember { mutableStateListOf<Uri>() }
    var cameraUri by remember { mutableStateOf<Uri?>(null) }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.GetMultipleContents()) { uris -> images.addAll(uris.take(6 - images.size)) }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { success -> if (success) cameraUri?.let { images.add(it) } }
    val cameraPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) createCaptureUri(context).also { cameraUri = it; camera.launch(it) }
    }
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.padding(20.dp, 0.dp, 20.dp, 34.dp)) {
            Text("记录这一刻", style = MaterialTheme.typography.headlineSmall)
            Text("文字会和此刻的照片、位置保存在同一条记录里。", color = MaterialTheme.colorScheme.onSurfaceVariant)
            OutlinedTextField(
                value = note, onValueChange = { note = it }, modifier = Modifier.fillMaxWidth().padding(top = 15.dp),
                minLines = 3, maxLines = 6, placeholder = { Text("风、气味、同行人的一句话……") }, shape = RoundedCornerShape(15.dp)
            )
            Row(Modifier.fillMaxWidth().padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedButton(onClick = { cameraPermission.launch(Manifest.permission.CAMERA) }, enabled = images.size < 6, modifier = Modifier.weight(1f)) {
                    Icon(Icons.Outlined.CameraAlt, null); Text("拍照", Modifier.padding(start = 6.dp))
                }
                OutlinedButton(onClick = { picker.launch("image/*") }, enabled = images.size < 6, modifier = Modifier.weight(1f)) {
                    Icon(Icons.Outlined.Image, null); Text("相册", Modifier.padding(start = 6.dp))
                }
            }
            if (images.isNotEmpty()) {
                Row(Modifier.fillMaxWidth().padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    images.take(4).forEach { uri -> AsyncImage(uri, null, Modifier.size(66.dp).clip(RoundedCornerShape(11.dp)).clickable { images.remove(uri) }) }
                    if (images.size > 4) Surface(shape = RoundedCornerShape(11.dp), color = MaterialTheme.colorScheme.surfaceVariant) { Box(Modifier.size(66.dp), contentAlignment = Alignment.Center) { Text("+${images.size - 4}") } }
                }
                Text("点击缩略图可移除", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Button(
                onClick = { onSave(note, images.toList()) }, enabled = !busy && (note.isNotBlank() || images.isNotEmpty()),
                modifier = Modifier.fillMaxWidth().height(52.dp).padding(top = 12.dp), shape = RoundedCornerShape(14.dp)
            ) { if (busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = Color.White) else Text("保存沿途记录") }
        }
    }
}

@Composable
private fun AdjustSheet(busy: Boolean, onDismiss: () -> Unit, onAdjust: (String, Int?, String?) -> Unit) {
    var custom by remember { mutableStateOf("") }
    var minutes by remember { mutableStateOf<Int?>(null) }
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.padding(20.dp, 0.dp, 20.dp, 34.dp)) {
            Text("边走边调整", style = MaterialTheme.typography.headlineSmall)
            Text("已经走过的地点会锁定，只改剩余路线。", color = MaterialTheme.colorScheme.onSurfaceVariant)
            FlowRow(Modifier.fillMaxWidth().padding(top = 14.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                QuickAdjust(Icons.Outlined.MoreTime, "时间不够") { onAdjust("time_short", minutes ?: 45, null) }
                QuickAdjust(Icons.Outlined.Restaurant, "想休息") { onAdjust("rest", null, null) }
                QuickAdjust(Icons.Outlined.DirectionsWalk, "有点累") { onAdjust("tired", null, null) }
                QuickAdjust(Icons.Outlined.AutoAwesome, "附近惊喜") { onAdjust("custom", null, "结合我的偏好和当前位置，推荐一个值得临时拐去、且不会明显增加负担的附近地点") }
            }
            Text("如果时间变了", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 18.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                listOf(30, 45, 60, 90).forEach { value -> FilterChip(selected = minutes == value, onClick = { minutes = value }, label = { Text("$value 分") }) }
            }
            OutlinedTextField(
                value = custom, onValueChange = { custom = it }, modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
                label = { Text("或者直接告诉 Agent") }, placeholder = { Text("不去咖啡馆，换成安静的公园") },
                minLines = 2, shape = RoundedCornerShape(15.dp)
            )
            Button(
                onClick = { onAdjust(if (custom.isNotBlank()) "custom" else "time_short", minutes, custom.takeIf { it.isNotBlank() }) },
                enabled = !busy && (custom.isNotBlank() || minutes != null), modifier = Modifier.fillMaxWidth().padding(top = 12.dp).height(50.dp)
            ) { Text("重新安排剩余路线") }
        }
    }
}

@Composable
private fun QuickAdjust(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, onClick: () -> Unit) {
    Surface(onClick = onClick, shape = RoundedCornerShape(13.dp), color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = .65f)) {
        Row(Modifier.padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, null, Modifier.size(18.dp), tint = Terracotta); Text(label, Modifier.padding(start = 6.dp), fontWeight = FontWeight.Bold)
        }
    }
}

private fun syncLabel(state: SyncState) = when (state) {
    SyncState.SYNCING -> "同步中"
    SyncState.SYNCED -> "已同步"
    SyncState.OFFLINE -> "离线记录"
    SyncState.ERROR -> "稍后重试"
    SyncState.IDLE -> "本机保存"
}

private fun createCaptureUri(context: Context): Uri {
    val dir = File(context.filesDir, "walk-photos").apply { mkdirs() }
    val file = File(dir, "capture_${System.currentTimeMillis()}.jpg")
    return FileProvider.getUriForFile(context, "${context.packageName}.files", file)
}

private fun openNavigation(context: Context, name: String, point: com.citywalk.pulse.data.GeoPoint?) {
    val uri = if (point != null) Uri.parse("androidamap://navi?sourceApplication=CityWalkPulse&poiname=${Uri.encode(name)}&lat=${point.lat}&lon=${point.lng}&dev=0&style=2")
    else Uri.parse("androidamap://keywordNavi?sourceApplication=CityWalkPulse&keyword=${Uri.encode(name)}")
    val intent = Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    runCatching { context.startActivity(intent) }.onFailure {
        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://uri.amap.com/search?keyword=${Uri.encode(name)}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}
