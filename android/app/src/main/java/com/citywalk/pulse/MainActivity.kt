package com.citywalk.pulse

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.DirectionsWalk
import androidx.compose.material.icons.outlined.PersonOutline
import androidx.compose.material.icons.outlined.Route
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.core.content.ContextCompat
import com.citywalk.pulse.data.AppSession
import com.citywalk.pulse.data.MainTab
import com.citywalk.pulse.ui.AppViewModel
import com.citywalk.pulse.ui.screens.AuthScreen
import com.citywalk.pulse.ui.screens.ProfileScreen
import com.citywalk.pulse.ui.screens.RoutesScreen
import com.citywalk.pulse.ui.screens.WalkScreen
import com.citywalk.pulse.ui.theme.CityWalkTheme

class MainActivity : ComponentActivity() {
    private val viewModel: AppViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent { CityWalkTheme { CityWalkApp(viewModel) } }
    }
}

@Composable
private fun CityWalkApp(viewModel: AppViewModel) {
    val ui by viewModel.ui.collectAsState()
    val mobile by viewModel.mobile.collectAsState()
    val context = androidx.compose.ui.platform.LocalContext.current
    val snackbar = remember { SnackbarHostState() }
    val locationPermissions = buildList {
        add(Manifest.permission.ACCESS_FINE_LOCATION)
        add(Manifest.permission.ACCESS_COARSE_LOCATION)
        if (Build.VERSION.SDK_INT >= 33) add(Manifest.permission.POST_NOTIFICATIONS)
    }.toTypedArray()
    val permissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        val granted = result[Manifest.permission.ACCESS_FINE_LOCATION] == true || result[Manifest.permission.ACCESS_COARSE_LOCATION] == true
        if (granted) ContextCompat.startForegroundService(context, Intent(context, LocationTrackingService::class.java))
    }
    val requestTracking = {
        val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
        if (granted) ContextCompat.startForegroundService(context, Intent(context, LocationTrackingService::class.java))
        else permissionLauncher.launch(locationPermissions)
    }
    val stopTracking = { context.stopService(Intent(context, LocationTrackingService::class.java)); Unit }

    val message = ui.error ?: ui.notice ?: mobile.message
    LaunchedEffect(message) {
        if (!message.isNullOrBlank()) {
            snackbar.showSnackbar(message)
            viewModel.clearMessage()
        }
    }

    when (val session = ui.session) {
        AppSession.Loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        AppSession.SignedOut -> AuthScreen(ui.authBusy, ui.error, viewModel::login)
        is AppSession.SignedIn -> Scaffold(
            modifier = Modifier.fillMaxSize(),
            containerColor = MaterialTheme.colorScheme.background,
            snackbarHost = { SnackbarHost(snackbar) },
            bottomBar = {
                NavigationBar(containerColor = MaterialTheme.colorScheme.surface) {
                    NavigationItem(MainTab.ROUTES, ui.tab, Icons.Outlined.Route, "路线") { viewModel.setTab(MainTab.ROUTES) }
                    NavigationItem(MainTab.WALK, ui.tab, Icons.Outlined.DirectionsWalk, if (mobile.activeWalk != null) "漫步中" else "漫步") { viewModel.setTab(MainTab.WALK) }
                    NavigationItem(MainTab.PROFILE, ui.tab, Icons.Outlined.PersonOutline, "我的") { viewModel.setTab(MainTab.PROFILE) }
                }
            }
        ) { padding ->
            Box(Modifier.fillMaxSize().padding(padding)) {
                when (ui.tab) {
                    MainTab.ROUTES -> RoutesScreen(
                        favorites = mobile.favorites, handoff = mobile.handoff, selected = ui.selectedRoute, loading = mobile.loading,
                        onRefresh = viewModel::refresh, onSelect = viewModel::selectRoute,
                        onStart = viewModel::startRoute, onClaim = viewModel::claimHandoff
                    )
                    MainTab.WALK -> WalkScreen(
                        walk = mobile.activeWalk, syncState = mobile.syncState, busy = ui.operationBusy,
                        onRequestTracking = requestTracking, onStopTracking = stopTracking,
                        onMarkNext = viewModel::markNext, onAddMoment = viewModel::addMoment,
                        onAdjust = viewModel::adjust, onUndo = viewModel::undoAdjustment,
                        onFinish = viewModel::finishWalk, onGoRoutes = { viewModel.setTab(MainTab.ROUTES) }
                    )
                    MainTab.PROFILE -> ProfileScreen(session.user, mobile, ui.apiBase, viewModel::saveApiBase, viewModel::logout)
                }
            }
        }
    }
}

@Composable
private fun androidx.compose.foundation.layout.RowScope.NavigationItem(
    tab: MainTab, selected: MainTab, icon: ImageVector, label: String, onClick: () -> Unit
) {
    NavigationBarItem(
        selected = tab == selected, onClick = onClick,
        icon = { Icon(icon, label) }, label = { Text(label) }
    )
}
