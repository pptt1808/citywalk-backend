package com.citywalk.pulse.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

val Paper = Color(0xFFF8F4EA)
val PaperLight = Color(0xFFFFFCF4)
val Ink = Color(0xFF332A24)
val InkSoft = Color(0xFF74665D)
val Terracotta = Color(0xFF974300)
val TerracottaSoft = Color(0xFFFFE9DA)
val Moss = Color(0xFF5D6E43)
val MossSoft = Color(0xFFE7EDD5)
val Line = Color(0xFFE1D6C8)
val ErrorRed = Color(0xFFA33F38)

private val CityWalkColors = lightColorScheme(
    primary = Terracotta,
    onPrimary = Color.White,
    primaryContainer = TerracottaSoft,
    onPrimaryContainer = Color(0xFF5B2500),
    secondary = Moss,
    onSecondary = Color.White,
    secondaryContainer = MossSoft,
    onSecondaryContainer = Color(0xFF35401F),
    background = Paper,
    onBackground = Ink,
    surface = PaperLight,
    onSurface = Ink,
    surfaceVariant = Color(0xFFF0E9DD),
    onSurfaceVariant = InkSoft,
    outline = Color(0xFF9B8A7D),
    outlineVariant = Line,
    error = ErrorRed
)

@Composable
fun CityWalkTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = CityWalkColors,
        typography = MaterialTheme.typography.copy(
            displaySmall = TextStyle(fontFamily = FontFamily.Serif, fontWeight = FontWeight.Bold, fontSize = 34.sp, lineHeight = 40.sp),
            headlineMedium = TextStyle(fontFamily = FontFamily.Serif, fontWeight = FontWeight.Bold, fontSize = 25.sp, lineHeight = 31.sp),
            headlineSmall = TextStyle(fontFamily = FontFamily.Serif, fontWeight = FontWeight.SemiBold, fontSize = 21.sp, lineHeight = 27.sp),
            titleLarge = TextStyle(fontFamily = FontFamily.Serif, fontWeight = FontWeight.Bold, fontSize = 19.sp, lineHeight = 25.sp),
            titleMedium = TextStyle(fontWeight = FontWeight.Bold, fontSize = 16.sp, lineHeight = 22.sp),
            bodyLarge = TextStyle(fontSize = 16.sp, lineHeight = 24.sp),
            bodyMedium = TextStyle(fontSize = 14.sp, lineHeight = 21.sp),
            bodySmall = TextStyle(fontSize = 12.sp, lineHeight = 18.sp),
            labelLarge = TextStyle(fontWeight = FontWeight.Bold, fontSize = 14.sp),
            labelMedium = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 12.sp)
        ),
        content = content
    )
}
