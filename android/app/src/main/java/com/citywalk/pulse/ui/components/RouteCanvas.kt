package com.citywalk.pulse.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.unit.dp
import com.citywalk.pulse.data.ActiveWalk
import com.citywalk.pulse.data.GeoPoint
import com.citywalk.pulse.data.PlanningResult
import com.citywalk.pulse.ui.theme.InkSoft
import com.citywalk.pulse.ui.theme.Line
import com.citywalk.pulse.ui.theme.Moss
import com.citywalk.pulse.ui.theme.PaperLight
import com.citywalk.pulse.ui.theme.Terracotta
import kotlin.math.max
import kotlin.math.min

@Composable
fun RouteCanvas(route: PlanningResult, walk: ActiveWalk?, modifier: Modifier = Modifier) {
    Box(modifier.background(PaperLight, RoundedCornerShape(28.dp))) {
        Canvas(Modifier.fillMaxSize().padding(16.dp)) {
            val grid = 28.dp.toPx()
            var x = 0f
            while (x < size.width) {
                drawLine(Line.copy(alpha = .28f), Offset(x, 0f), Offset(x, size.height), 1f)
                x += grid
            }
            var y = 0f
            while (y < size.height) {
                drawLine(Line.copy(alpha = .28f), Offset(0f, y), Offset(size.width, y), 1f)
                y += grid
            }

            val coordinates = route.stops.mapNotNull { it.geoPoint }
            val rawTrail = walk?.locationTrail.orEmpty().map { GeoPoint(it.lng, it.lat, it.accuracy) }
            val boundedTrail = if (coordinates.isEmpty()) emptyList() else rawTrail.filter { point ->
                val minLng = coordinates.minOf { it.lng } - .12
                val maxLng = coordinates.maxOf { it.lng } + .12
                val minLat = coordinates.minOf { it.lat } - .12
                val maxLat = coordinates.maxOf { it.lat } + .12
                point.lng in minLng..maxLng && point.lat in minLat..maxLat
            }
            val accurate = coordinates.size == route.stops.size && coordinates.isNotEmpty()
            val projected = if (accurate) project(coordinates + boundedTrail, size.width, size.height) else emptyList()
            val points = if (accurate) {
                projected.take(coordinates.size)
            } else {
                route.stops.indices.map { index ->
                    val count = max(1, route.stops.lastIndex)
                    val ratio = index.toFloat() / count
                    Offset(
                        size.width * (.14f + .72f * ratio),
                        size.height * (.25f + .48f * (if (index % 2 == 0) ratio else 1 - ratio) + .08f * (index % 3))
                    )
                }
            }
            if (points.size > 1) {
                val routePath = Path().apply {
                    moveTo(points.first().x, points.first().y)
                    points.drop(1).forEach { lineTo(it.x, it.y) }
                }
                drawPath(routePath, Color.White, style = Stroke(9.dp.toPx(), cap = StrokeCap.Round))
                drawPath(routePath, Moss, style = Stroke(4.dp.toPx(), cap = StrokeCap.Round))
            }

            val progressByName = walk?.stopProgress?.associateBy { it.name }.orEmpty()
            points.forEachIndexed { index, point ->
                val stop = route.stops[index]
                val status = progressByName[stop.name]?.status
                val color = when (status) {
                    "visited" -> Moss
                    "skipped" -> InkSoft
                    "arrived" -> Color(0xFFD08328)
                    else -> Terracotta
                }
                drawCircle(Color.White, 15.dp.toPx(), point)
                drawCircle(color, 11.dp.toPx(), point)
                drawContext.canvas.nativeCanvas.apply {
                    val paint = android.graphics.Paint().apply {
                        isAntiAlias = true; textAlign = android.graphics.Paint.Align.CENTER
                        textSize = 11.dp.toPx(); this.color = android.graphics.Color.WHITE; isFakeBoldText = true
                    }
                    drawText("${index + 1}", point.x, point.y + 4.dp.toPx(), paint)
                }
            }

            if (boundedTrail.isNotEmpty() && accurate) {
                val trailPoints = projected.takeLast(boundedTrail.size)
                val trailPath = Path().apply {
                    moveTo(trailPoints.first().x, trailPoints.first().y)
                    trailPoints.drop(1).forEach { lineTo(it.x, it.y) }
                }
                if (trailPoints.size > 1) drawPath(trailPath, Terracotta.copy(alpha = .65f), style = Stroke(3.dp.toPx(), cap = StrokeCap.Round))
                drawCircle(Color.White, 10.dp.toPx(), trailPoints.last())
                drawCircle(Terracotta, 6.dp.toPx(), trailPoints.last())
            }
        }
    }
}

private fun project(points: List<GeoPoint>, width: Float, height: Float): List<Offset> {
    val minLng = points.minOf { it.lng }
    val maxLng = points.maxOf { it.lng }
    val minLat = points.minOf { it.lat }
    val maxLat = points.maxOf { it.lat }
    val lngSpan = max(0.0001, maxLng - minLng)
    val latSpan = max(0.0001, maxLat - minLat)
    val usableWidth = width * .76f
    val usableHeight = height * .70f
    val scale = min(usableWidth / lngSpan.toFloat(), usableHeight / latSpan.toFloat())
    val drawnWidth = lngSpan.toFloat() * scale
    val drawnHeight = latSpan.toFloat() * scale
    val left = (width - drawnWidth) / 2f
    val top = (height - drawnHeight) / 2f
    return points.map { Offset(left + ((it.lng - minLng).toFloat() * scale), top + ((maxLat - it.lat).toFloat() * scale)) }
}
