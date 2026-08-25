package com.citywalk.pulse.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CloudSync
import androidx.compose.material.icons.outlined.Logout
import androidx.compose.material.icons.outlined.PhoneAndroid
import androidx.compose.material.icons.outlined.Save
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.citywalk.pulse.data.AuthUser
import com.citywalk.pulse.data.MobileDataState
import com.citywalk.pulse.data.SyncState
import com.citywalk.pulse.ui.theme.Moss
import com.citywalk.pulse.ui.theme.Terracotta

@Composable
fun ProfileScreen(user: AuthUser, data: MobileDataState, apiBase: String, onSaveBase: (String) -> Unit, onLogout: () -> Unit) {
    var base by remember(apiBase) { mutableStateOf(apiBase) }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp, 18.dp, 20.dp, 110.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Surface(shape = CircleShape, color = MaterialTheme.colorScheme.primaryContainer) {
                Text(user.username.take(1).uppercase(), modifier = Modifier.padding(horizontal = 19.dp, vertical = 13.dp), style = MaterialTheme.typography.headlineMedium, color = Terracotta, fontWeight = FontWeight.Black)
            }
            Column(Modifier.padding(start = 14.dp)) {
                Text(user.username, style = MaterialTheme.typography.headlineSmall)
                Text("移动漫步者 · 与网页端共享账号", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Surface(shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.secondaryContainer) {
            Column(Modifier.padding(18.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.PhoneAndroid, null, tint = Moss)
                    Text("移动端职责", fontWeight = FontWeight.Bold, color = Moss, modifier = Modifier.padding(start = 8.dp))
                }
                Text("执行路线、持续定位、沿途图文和实时改路；结束后把原始记录同步到网页端。路线生成、收藏管理和手账编辑保留在网页端。", modifier = Modifier.padding(top = 8.dp), color = MaterialTheme.colorScheme.onSecondaryContainer)
            }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Stat("收藏", data.favorites.size.toString(), Modifier.weight(1f))
            Stat("同步", if (data.syncState == SyncState.SYNCED) "正常" else "待处理", Modifier.weight(1f))
            Stat("进行中", if (data.activeWalk != null) "1" else "0", Modifier.weight(1f))
        }
        Surface(shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.surface, border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
            Column(Modifier.padding(18.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.CloudSync, null, tint = Terracotta)
                    Text("联调服务地址", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(start = 8.dp))
                }
                Text("模拟器默认通过 adb reverse 访问 127.0.0.1。真机联调时改为电脑局域网 IP。", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 6.dp))
                OutlinedTextField(value = base, onValueChange = { base = it }, modifier = Modifier.fillMaxWidth().padding(top = 12.dp), singleLine = true, label = { Text("API Base URL") }, shape = RoundedCornerShape(13.dp))
                Button(onClick = { onSaveBase(base) }, modifier = Modifier.fillMaxWidth().padding(top = 10.dp).height(48.dp)) {
                    Icon(Icons.Outlined.Save, null); Text("保存并重新连接", Modifier.padding(start = 7.dp))
                }
            }
        }
        OutlinedButton(onClick = onLogout, modifier = Modifier.fillMaxWidth().height(48.dp)) {
            Icon(Icons.Outlined.Logout, null); Text("退出登录", Modifier.padding(start = 7.dp))
        }
    }
}

@Composable
private fun Stat(label: String, value: String, modifier: Modifier) {
    Surface(modifier, shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = .62f)) {
        Column(Modifier.padding(13.dp)) { Text(value, style = MaterialTheme.typography.titleLarge); Text(label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
}
