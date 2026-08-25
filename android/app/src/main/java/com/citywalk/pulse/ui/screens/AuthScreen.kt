package com.citywalk.pulse.ui.screens

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowForward
import androidx.compose.material.icons.outlined.LocationOn
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.citywalk.pulse.ui.theme.Moss
import com.citywalk.pulse.ui.theme.Paper
import com.citywalk.pulse.ui.theme.PaperLight
import com.citywalk.pulse.ui.theme.Terracotta

@Composable
fun AuthScreen(busy: Boolean, error: String?, onSubmit: (String, String, Boolean) -> Unit) {
    var username by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var register by remember { mutableStateOf(false) }
    val focusManager = LocalFocusManager.current
    Box(Modifier.fillMaxSize().background(Paper)) {
        Canvas(Modifier.fillMaxSize()) {
            val path = Path().apply {
                moveTo(-40f, size.height * .22f)
                cubicTo(size.width * .28f, size.height * .09f, size.width * .65f, size.height * .38f, size.width + 60f, size.height * .18f)
                cubicTo(size.width * .75f, size.height * .46f, size.width * .27f, size.height * .47f, -50f, size.height * .66f)
            }
            drawPath(path, Moss.copy(alpha = .20f), style = Stroke(28f))
            listOf(.15f to .27f, .72f to .25f, .35f to .53f, .82f to .48f).forEachIndexed { index, pair ->
                drawCircle(Color.White.copy(alpha = .8f), 19f, Offset(size.width * pair.first, size.height * pair.second))
                drawCircle(if (index % 2 == 0) Terracotta else Moss, 11f, Offset(size.width * pair.first, size.height * pair.second))
            }
        }
        Column(
            Modifier.fillMaxSize().padding(horizontal = 24.dp, vertical = 34.dp),
            verticalArrangement = Arrangement.SpaceBetween
        ) {
            Column {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Surface(shape = RoundedCornerShape(50), color = Terracotta) {
                        androidx.compose.material3.Icon(Icons.Outlined.LocationOn, null, tint = Color.White, modifier = Modifier.padding(10.dp))
                    }
                    Text("CITYWALK PULSE", modifier = Modifier.padding(start = 10.dp), fontWeight = FontWeight.Black, letterSpacing = 1.5.sp, color = Terracotta)
                }
                Spacer(Modifier.height(34.dp))
                Text("把一座城市，\n走成自己的故事。", style = MaterialTheme.typography.displaySmall)
                Text("规划留给桌面，感受留在路上。移动端接住路线、定位和沿途图文，结束后同步回网页。", modifier = Modifier.padding(top = 14.dp).fillMaxWidth(.88f), color = MaterialTheme.colorScheme.onSurfaceVariant, lineHeight = 22.sp)
            }

            Surface(
                modifier = Modifier.fillMaxWidth(),
                color = PaperLight.copy(alpha = .96f),
                shape = RoundedCornerShape(28.dp),
                tonalElevation = 2.dp,
                shadowElevation = 12.dp
            ) {
                Column(Modifier.padding(22.dp)) {
                    Text(if (register) "创建旅行者档案" else "继续你的漫步", style = MaterialTheme.typography.headlineSmall)
                    Text(if (register) "注册后网页和手机使用同一份路线" else "使用网页端相同账号登录", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                    Spacer(Modifier.height(18.dp))
                    OutlinedTextField(
                        value = username, onValueChange = { username = it }, modifier = Modifier.fillMaxWidth(),
                        label = { Text("用户名") }, singleLine = true, shape = RoundedCornerShape(14.dp),
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                        keyboardActions = KeyboardActions(onNext = { focusManager.moveFocus(FocusDirection.Down) })
                    )
                    Spacer(Modifier.height(10.dp))
                    OutlinedTextField(
                        value = password, onValueChange = { password = it }, modifier = Modifier.fillMaxWidth(),
                        label = { Text("密码（至少 8 位）") }, singleLine = true,
                        visualTransformation = PasswordVisualTransformation(), shape = RoundedCornerShape(14.dp),
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                        keyboardActions = KeyboardActions(onDone = {
                            focusManager.clearFocus()
                            if (!busy && username.trim().length >= 3 && password.length >= 8) onSubmit(username.trim(), password, register)
                        })
                    )
                    if (error != null) Text(error, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 10.dp), style = MaterialTheme.typography.bodySmall)
                    Button(
                        onClick = { onSubmit(username.trim(), password, register) },
                        enabled = !busy && username.trim().length >= 3 && password.length >= 8,
                        modifier = Modifier.fillMaxWidth().padding(top = 16.dp).height(50.dp),
                        shape = RoundedCornerShape(14.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = Terracotta)
                    ) {
                        if (busy) CircularProgressIndicator(Modifier.height(20.dp), strokeWidth = 2.dp, color = Color.White)
                        else {
                            Text(if (register) "注册并进入" else "登录并接收路线")
                            androidx.compose.material3.Icon(Icons.Outlined.ArrowForward, null, Modifier.padding(start = 7.dp))
                        }
                    }
                    TextButton(onClick = { register = !register }, modifier = Modifier.align(Alignment.CenterHorizontally)) {
                        Text(if (register) "已有账号，直接登录" else "第一次使用？创建账号")
                    }
                }
            }
        }
    }
}
