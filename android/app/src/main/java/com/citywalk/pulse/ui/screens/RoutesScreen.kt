@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.citywalk.pulse.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowForward
import androidx.compose.material.icons.outlined.CloudDownload
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Route
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.citywalk.pulse.data.FavoriteRoute
import com.citywalk.pulse.data.PlanningResult
import com.citywalk.pulse.data.RouteHandoff
import com.citywalk.pulse.ui.components.RouteMap
import com.citywalk.pulse.ui.theme.Moss
import com.citywalk.pulse.ui.theme.MossSoft
import com.citywalk.pulse.ui.theme.Terracotta

@Composable
fun RoutesScreen(
    favorites: List<FavoriteRoute>, handoff: RouteHandoff?, selected: PlanningResult?, loading: Boolean,
    onRefresh: () -> Unit, onSelect: (PlanningResult?) -> Unit,
    onStart: (PlanningResult) -> Unit, onClaim: (RouteHandoff) -> Unit
) {
    LazyColumn(
        Modifier.fillMaxSize(), contentPadding = androidx.compose.foundation.layout.PaddingValues(20.dp, 18.dp, 20.dp, 110.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        item {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("路线接力站", style = MaterialTheme.typography.headlineMedium)
                    Text("网页端认真规划，手机端直接出发", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                IconButton(onClick = onRefresh, enabled = !loading) { Icon(Icons.Outlined.Refresh, "刷新") }
            }
        }
        if (handoff != null) item {
            Surface(color = MossSoft, shape = RoundedCornerShape(20.dp), modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(18.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Outlined.CloudDownload, null, tint = Moss)
                        Text("网页端刚刚发来一条路线", modifier = Modifier.padding(start = 8.dp), color = Moss, fontWeight = FontWeight.Bold)
                    }
                    Text(handoff.route.title, style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 10.dp))
                    Text(handoff.route.stops.joinToString(" → ") { it.name }, maxLines = 2, overflow = TextOverflow.Ellipsis, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Button(onClick = { onClaim(handoff) }, modifier = Modifier.fillMaxWidth().padding(top = 13.dp), colors = ButtonDefaults.buttonColors(containerColor = Moss)) {
                        Text("接收并开始漫步")
                        Icon(Icons.Outlined.ArrowForward, null, Modifier.padding(start = 7.dp))
                    }
                }
            }
        }
        item {
            Text("已收藏路线", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 8.dp))
            Text("收藏操作仍在网页完成，移动端只负责接住并执行。", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (favorites.isEmpty()) item {
            Surface(
                modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(20.dp),
                color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = .55f)
            ) {
                Column(Modifier.padding(28.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(Icons.Outlined.Route, null, tint = Terracotta)
                    Text("这里还没有路线", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 10.dp))
                    Text("先在网页 Agent 中生成并收藏，或点击“发送到手机”。", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        items(favorites, key = { it.id }) { favorite ->
            RouteCard(favorite.result, onClick = { onSelect(favorite.result) }, onStart = { onStart(favorite.result) })
        }
    }

    if (selected != null) RouteDetailSheet(selected, onDismiss = { onSelect(null) }, onStart = { onStart(selected) })
}

@Composable
private fun RouteCard(route: PlanningResult, onClick: () -> Unit, onStart: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick), shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)
    ) {
        Column(Modifier.padding(17.dp)) {
            Row(verticalAlignment = Alignment.Top) {
                Box(Modifier.background(MaterialTheme.colorScheme.primaryContainer, RoundedCornerShape(50)).padding(horizontal = 10.dp, vertical = 6.dp)) {
                    Text("${route.stops.size} 站", color = Terracotta, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.labelMedium)
                }
                Column(Modifier.padding(start = 11.dp).weight(1f)) {
                    Text(route.city.ifBlank { "CITYWALK" }, color = Moss, style = MaterialTheme.typography.labelMedium)
                    Text(route.title, style = MaterialTheme.typography.titleLarge, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
            }
            Text(route.stops.joinToString("  ·  ") { it.name }, modifier = Modifier.padding(top = 12.dp), maxLines = 2, overflow = TextOverflow.Ellipsis, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Row(Modifier.fillMaxWidth().padding(top = 14.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text("约 ${route.totalEstimatedMinutes} 分钟  ·  ¥${route.totalEstimatedCost.toInt()}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Button(onClick = onStart, shape = RoundedCornerShape(12.dp), contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 14.dp, vertical = 7.dp)) { Text("现在出发") }
            }
        }
    }
}

@Composable
private fun RouteDetailSheet(route: PlanningResult, onDismiss: () -> Unit, onStart: () -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = MaterialTheme.colorScheme.background) {
        LazyColumn(contentPadding = androidx.compose.foundation.layout.PaddingValues(20.dp, 0.dp, 20.dp, 36.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item {
                Text(route.city, color = Moss, fontWeight = FontWeight.Bold)
                Text(route.title, style = MaterialTheme.typography.headlineMedium)
                Text(route.summary, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 6.dp))
                RouteMap(route, null, Modifier.fillMaxWidth().height(240.dp).padding(top = 16.dp))
            }
            items(route.stops.withIndex().toList()) { (index, stop) ->
                Row(Modifier.fillMaxWidth()) {
                    Surface(shape = RoundedCornerShape(50), color = if (index == 0) Terracotta else Moss) {
                        Text("${index + 1}", color = Color.White, modifier = Modifier.padding(horizontal = 9.dp, vertical = 5.dp), fontWeight = FontWeight.Bold)
                    }
                    Column(Modifier.padding(start = 12.dp).weight(1f)) {
                        Text(stop.name, style = MaterialTheme.typography.titleMedium)
                        Text(
                            listOfNotNull(
                                stop.subtype ?: stop.category,
                                if (stop.discoverySource == "web" && stop.verificationStatus == "map_matched") "公开发现 · 高德核验" else null
                            ).joinToString("  ·  "),
                            color = Moss,
                            style = MaterialTheme.typography.labelSmall
                        )
                        Text(stop.highlight ?: stop.reason, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                        if (!stop.address.isNullOrBlank()) Text(stop.address, color = Terracotta, style = MaterialTheme.typography.bodySmall)
                    }
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            }
            item {
                Button(onClick = onStart, modifier = Modifier.fillMaxWidth().height(52.dp), shape = RoundedCornerShape(14.dp)) {
                    Text("载入手机并开始漫步")
                }
                OutlinedButton(onClick = onDismiss, modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) { Text("稍后再走") }
            }
        }
    }
}
