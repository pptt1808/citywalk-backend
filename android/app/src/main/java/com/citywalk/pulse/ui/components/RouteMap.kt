@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.citywalk.pulse.ui.components

import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.net.Uri
import android.os.Bundle
import android.view.ViewGroup
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Map
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.amap.api.maps.AMap
import com.amap.api.maps.CameraUpdateFactory
import com.amap.api.maps.MapView
import com.amap.api.maps.model.BitmapDescriptorFactory
import com.amap.api.maps.model.LatLng
import com.amap.api.maps.model.LatLngBounds
import com.amap.api.maps.model.MarkerOptions
import com.amap.api.maps.model.PolylineOptions
import com.amap.api.services.core.LatLonPoint
import com.amap.api.services.route.RouteSearch
import com.amap.api.services.route.WalkRouteResult
import com.citywalk.pulse.AmapPrivacy
import com.citywalk.pulse.BuildConfig
import com.citywalk.pulse.data.ActiveWalk
import com.citywalk.pulse.data.GeoPoint
import com.citywalk.pulse.data.PlanningResult
import com.citywalk.pulse.ui.theme.Moss
import com.citywalk.pulse.ui.theme.Terracotta
import java.lang.reflect.Proxy
import kotlin.coroutines.resume
import kotlinx.coroutines.suspendCancellableCoroutine

private const val AMAP_PRIVACY_URL = "https://lbs.amap.com/pages/privacy/"

@Composable
fun RouteMap(route: PlanningResult, walk: ActiveWalk?, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val hasCoordinates = route.stops.any { it.geoPoint != null }
    var accepted by remember { mutableStateOf(AmapPrivacy.isAccepted(context)) }
    var useFallback by remember { mutableStateOf(false) }

    when {
        !BuildConfig.AMAP_ENABLED || !hasCoordinates || useFallback -> RouteCanvas(route, walk, modifier)
        !accepted -> MapConsent(
            modifier = modifier,
            onAccept = {
                AmapPrivacy.accept(context)
                accepted = true
            },
            onLater = { useFallback = true },
            onOpenPolicy = {
                context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(AMAP_PRIVACY_URL)))
            }
        )
        else -> {
            // The SDK requires restored consent before MapView construction.
            AmapPrivacy.restoreAcceptedConsent(context)
            AmapRouteMap(route, walk, modifier)
        }
    }
}

@Composable
private fun MapConsent(
    modifier: Modifier,
    onAccept: () -> Unit,
    onLater: () -> Unit,
    onOpenPolicy: () -> Unit
) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(24.dp),
        color = MaterialTheme.colorScheme.secondaryContainer
    ) {
        Column(
            Modifier.fillMaxSize().padding(22.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Icon(Icons.Outlined.Map, null, tint = Moss)
            Text("启用真实地图", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 10.dp))
            Text(
                "高德地图 SDK 将用于显示底图、路线和当前位置。启用前请阅读第三方隐私政策。",
                color = MaterialTheme.colorScheme.onSecondaryContainer,
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.padding(top = 7.dp)
            )
            Row(Modifier.fillMaxWidth().padding(top = 14.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = onOpenPolicy, modifier = Modifier.weight(1f)) { Text("隐私政策") }
                Button(onClick = onAccept, modifier = Modifier.weight(1f)) { Text("同意并启用") }
            }
            androidx.compose.material3.TextButton(onClick = onLater) { Text("暂时使用简图") }
        }
    }
}

private data class RenderCache(var overlays: String = "", var camera: String = "")

@Composable
private fun AmapRouteMap(route: PlanningResult, walk: ActiveWalk?, modifier: Modifier) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val coordinates = remember(route) { route.stops.mapNotNull { it.geoPoint } }
    val routeKey = remember(route) { route.stops.joinToString("|") { "${it.name}:${it.location}" } }
    var roadSegments by remember(routeKey) { mutableStateOf<List<List<LatLng>>>(emptyList()) }
    val mapView = remember {
        MapView(context).apply {
            layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            onCreate(Bundle())
        }
    }
    val cache = remember(mapView) { RenderCache() }

    DisposableEffect(mapView, lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_RESUME -> mapView.onResume()
                Lifecycle.Event.ON_PAUSE -> mapView.onPause()
                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        if (lifecycleOwner.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) mapView.onResume()
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
            mapView.onPause()
            mapView.onDestroy()
        }
    }

    LaunchedEffect(routeKey) {
        roadSegments = coordinates.zipWithNext().map { (from, to) ->
            loadWalkingLeg(context, from, to).ifEmpty {
                listOf(LatLng(from.lat, from.lng), LatLng(to.lat, to.lng))
            }
        }
    }

    val renderKey = buildString {
        append(routeKey)
        append('|').append(walk?.updatedAt.orEmpty())
        append('|').append(roadSegments.sumOf { it.size })
    }

    Box(modifier.clip(RoundedCornerShape(24.dp))) {
        AndroidView(
            factory = { mapView },
            update = { view ->
                if (cache.overlays != renderKey) {
                    renderOverlays(view.map, route, walk, coordinates, roadSegments)
                    cache.overlays = renderKey
                }
                if (cache.camera != routeKey) {
                    cache.camera = routeKey
                    view.post { fitCamera(view.map, coordinates, walk?.currentLocation) }
                }
            },
            modifier = Modifier.fillMaxSize()
        )
        Surface(
            modifier = Modifier.align(Alignment.BottomEnd).padding(9.dp),
            shape = RoundedCornerShape(50),
            color = MaterialTheme.colorScheme.surface.copy(alpha = .88f)
        ) {
            Text(
                if (roadSegments.isEmpty() && coordinates.size > 1) "道路路线加载中" else "高德地图",
                modifier = Modifier.padding(horizontal = 9.dp, vertical = 5.dp),
                style = MaterialTheme.typography.labelSmall,
                color = Moss,
                fontWeight = FontWeight.Bold
            )
        }
    }
}

private fun renderOverlays(
    map: AMap,
    route: PlanningResult,
    walk: ActiveWalk?,
    coordinates: List<GeoPoint>,
    roadSegments: List<List<LatLng>>
) {
    map.clear()
    map.mapType = AMap.MAP_TYPE_NORMAL
    map.uiSettings.apply {
        isZoomControlsEnabled = false
        isScaleControlsEnabled = true
        isCompassEnabled = false
        isRotateGesturesEnabled = false
        isTiltGesturesEnabled = false
    }

    val progress = walk?.stopProgress?.associateBy { it.name }.orEmpty()
    val segments = if (roadSegments.size == (coordinates.size - 1).coerceAtLeast(0)) roadSegments
    else coordinates.zipWithNext().map { (from, to) -> listOf(LatLng(from.lat, from.lng), LatLng(to.lat, to.lng)) }
    segments.forEachIndexed { index, points ->
        if (points.size < 2) return@forEachIndexed
        val destinationPoint = coordinates.getOrNull(index + 1)
        val destination = route.stops.firstOrNull { it.geoPoint == destinationPoint }
        val status = destination?.let { progress[it.name]?.status }
        val completed = status == "visited" || status == "skipped"
        map.addPolyline(PolylineOptions().addAll(points).width(18f).color(Color.WHITE).zIndex(4f))
        map.addPolyline(
            PolylineOptions().addAll(points).width(10f)
                .color(if (completed) Color.rgb(126, 133, 117) else Color.rgb(84, 105, 67))
                .zIndex(5f)
        )
    }

    route.stops.forEachIndexed { index, stop ->
        val point = stop.geoPoint ?: return@forEachIndexed
        val status = progress[stop.name]?.status
        val markerColor = when (status) {
            "visited" -> Color.rgb(84, 105, 67)
            "skipped" -> Color.rgb(126, 133, 117)
            "arrived" -> Color.rgb(208, 131, 40)
            else -> Color.rgb(190, 85, 55)
        }
        map.addMarker(
            MarkerOptions()
                .position(LatLng(point.lat, point.lng))
                .title("${index + 1}. ${stop.name}")
                .snippet(stop.address ?: stop.reason)
                .icon(BitmapDescriptorFactory.fromBitmap(numberMarker(index + 1, markerColor)))
                .anchor(.5f, .5f)
                .zIndex(10f)
        )
    }

    val boundedTrail = walk?.locationTrail.orEmpty().filter { trail -> nearRoute(trail.lng, trail.lat, coordinates) }
    if (boundedTrail.size > 1) {
        map.addPolyline(
            PolylineOptions().addAll(boundedTrail.map { LatLng(it.lat, it.lng) })
                .width(9f).color(Color.rgb(216, 103, 70)).zIndex(8f)
        )
    }
    walk?.currentLocation?.takeIf { nearRoute(it.lng, it.lat, coordinates) }?.let { current ->
        map.addCircle(
            com.amap.api.maps.model.CircleOptions().center(LatLng(current.lat, current.lng))
                .radius((current.accuracy ?: 20.0).coerceIn(8.0, 100.0))
                .fillColor(Color.argb(35, 51, 132, 255)).strokeColor(Color.argb(90, 51, 132, 255)).strokeWidth(2f)
        )
        map.addMarker(
            MarkerOptions().position(LatLng(current.lat, current.lng)).title("你在这里")
                .icon(BitmapDescriptorFactory.fromBitmap(currentLocationMarker())).anchor(.5f, .5f).zIndex(15f)
        )
    }
}

private fun fitCamera(map: AMap, coordinates: List<GeoPoint>, current: GeoPoint?) {
    if (coordinates.isEmpty()) return
    if (coordinates.size == 1) {
        val only = coordinates.first()
        map.moveCamera(CameraUpdateFactory.newLatLngZoom(LatLng(only.lat, only.lng), 16f))
        return
    }
    val builder = LatLngBounds.builder()
    coordinates.forEach { builder.include(LatLng(it.lat, it.lng)) }
    current?.takeIf { nearRoute(it.lng, it.lat, coordinates) }?.let { builder.include(LatLng(it.lat, it.lng)) }
    runCatching { map.animateCamera(CameraUpdateFactory.newLatLngBounds(builder.build(), 110)) }
}

@Suppress("DEPRECATION") // 9.x is intentionally retained for the x86_64 emulator ABI.
private suspend fun loadWalkingLeg(context: android.content.Context, from: GeoPoint, to: GeoPoint): List<LatLng> =
    suspendCancellableCoroutine { continuation ->
        val search = runCatching { RouteSearch(context.applicationContext) }.getOrElse {
            continuation.resume(emptyList())
            return@suspendCancellableCoroutine
        }
        val listener = Proxy.newProxyInstance(
            RouteSearch.OnRouteSearchListener::class.java.classLoader,
            arrayOf(RouteSearch.OnRouteSearchListener::class.java)
        ) { _, method, args ->
            if (method.name == "onWalkRouteSearched" && continuation.isActive) {
                val result = args?.getOrNull(0) as? WalkRouteResult
                val code = args?.getOrNull(1) as? Int ?: -1
                val points = if (code == 1000) {
                    result?.paths?.firstOrNull()?.steps.orEmpty()
                        .flatMap { it.polyline.orEmpty() }
                        .map { LatLng(it.latitude, it.longitude) }
                } else emptyList()
                continuation.resume(points)
            }
            null
        } as RouteSearch.OnRouteSearchListener
        search.setRouteSearchListener(listener)
        val endpoints = RouteSearch.FromAndTo(LatLonPoint(from.lat, from.lng), LatLonPoint(to.lat, to.lng))
        search.calculateWalkRouteAsyn(RouteSearch.WalkRouteQuery(endpoints, RouteSearch.WALK_DEFAULT))
    }

private fun nearRoute(lng: Double, lat: Double, coordinates: List<GeoPoint>): Boolean {
    if (coordinates.isEmpty()) return false
    return lng in (coordinates.minOf { it.lng } - .12)..(coordinates.maxOf { it.lng } + .12) &&
        lat in (coordinates.minOf { it.lat } - .12)..(coordinates.maxOf { it.lat } + .12)
}

private fun numberMarker(number: Int, color: Int): Bitmap {
    val bitmap = Bitmap.createBitmap(82, 82, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { this.color = color }
    val border = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        this.color = Color.WHITE
        style = Paint.Style.STROKE
        strokeWidth = 7f
    }
    canvas.drawCircle(41f, 41f, 31f, fill)
    canvas.drawCircle(41f, 41f, 31f, border)
    val text = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        this.color = Color.WHITE
        textSize = 30f
        textAlign = Paint.Align.CENTER
        typeface = Typeface.DEFAULT_BOLD
    }
    canvas.drawText(number.toString(), 41f, 51f, text)
    return bitmap
}

private fun currentLocationMarker(): Bitmap {
    val bitmap = Bitmap.createBitmap(70, 70, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    canvas.drawCircle(35f, 35f, 24f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE })
    canvas.drawCircle(35f, 35f, 17f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(51, 132, 255) })
    return bitmap
}
