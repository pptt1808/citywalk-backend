package com.citywalk.pulse.ui

import android.app.Application
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.citywalk.pulse.CityWalkApplication
import com.citywalk.pulse.data.ApiException
import com.citywalk.pulse.data.AppSession
import com.citywalk.pulse.data.AuthUser
import com.citywalk.pulse.data.MainTab
import com.citywalk.pulse.data.MobileDataState
import com.citywalk.pulse.data.PlanningResult
import com.citywalk.pulse.data.RouteHandoff
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class UiState(
    val session: AppSession = AppSession.Loading,
    val tab: MainTab = MainTab.ROUTES,
    val selectedRoute: PlanningResult? = null,
    val authBusy: Boolean = false,
    val operationBusy: Boolean = false,
    val error: String? = null,
    val notice: String? = null,
    val apiBase: String = ""
)

class AppViewModel(application: Application) : AndroidViewModel(application) {
    private val app = application as CityWalkApplication
    private val api = app.api
    private val store = app.store
    private val repository = app.walkRepository
    val mobile: StateFlow<MobileDataState> = repository.state
    private val _ui = MutableStateFlow(UiState())
    val ui: StateFlow<UiState> = _ui.asStateFlow()

    init { bootstrap() }

    private fun bootstrap() = viewModelScope.launch {
        val saved = store.readUser()
        val base = store.getApiBase()
        _ui.value = _ui.value.copy(apiBase = base)
        val user = runCatching { api.me().user }.getOrNull() ?: saved?.takeIf {
            // A saved profile keeps the offline shell visible; authenticated calls
            // will surface a login prompt if the server session has expired.
            true
        }
        if (user == null) _ui.value = _ui.value.copy(session = AppSession.SignedOut)
        else acceptUser(user)
    }

    fun login(username: String, password: String, register: Boolean) = viewModelScope.launch {
        _ui.value = _ui.value.copy(authBusy = true, error = null)
        try {
            val user = if (register) api.register(username, password).user else api.login(username, password).user
            acceptUser(user)
        } catch (error: Exception) {
            _ui.value = _ui.value.copy(error = error.message ?: "登录失败")
        } finally {
            _ui.value = _ui.value.copy(authBusy = false)
        }
    }

    private suspend fun acceptUser(user: AuthUser) {
        store.saveUser(user)
        _ui.value = _ui.value.copy(session = AppSession.SignedIn(user), error = null)
        repository.initialize(user)
        if (repository.state.value.activeWalk != null) _ui.value = _ui.value.copy(tab = MainTab.WALK)
    }

    fun refresh() = viewModelScope.launch {
        val user = (_ui.value.session as? AppSession.SignedIn)?.user ?: return@launch
        repository.refresh(user)
    }

    fun logout() = viewModelScope.launch {
        api.logout()
        store.clearAccountData()
        _ui.value = UiState(session = AppSession.SignedOut, apiBase = store.getApiBase())
    }

    fun setTab(tab: MainTab) { _ui.value = _ui.value.copy(tab = tab, selectedRoute = null, error = null) }
    fun selectRoute(route: PlanningResult?) { _ui.value = _ui.value.copy(selectedRoute = route) }
    fun clearMessage() { _ui.value = _ui.value.copy(error = null, notice = null) }

    fun startRoute(route: PlanningResult) = runOperation("路线已载入，开始记录吧") {
        repository.startWalk(route)
        _ui.value = _ui.value.copy(tab = MainTab.WALK, selectedRoute = null)
    }

    fun claimHandoff(handoff: RouteHandoff) = runOperation("已接收网页端路线") {
        repository.claimAndStart(handoff)
        _ui.value = _ui.value.copy(tab = MainTab.WALK, selectedRoute = null)
    }

    fun addMoment(note: String, images: List<Uri>, done: () -> Unit = {}) = runOperation("沿途记录已保存", done) {
        repository.addMoment(note, images)
    }

    fun markNext(status: String) = runOperation(if (status == "skipped") "已跳过这一站" else "这一站已完成") {
        repository.markNext(status)
    }

    fun adjust(reason: String, minutes: Int? = null, custom: String? = null) = runOperation("只调整了未完成的路线") {
        repository.adjust(reason, minutes, custom)
    }

    fun undoAdjustment() = runOperation("已撤销最近一次改路") { repository.undoAdjustment() }

    fun finishWalk(done: () -> Unit = {}) = runOperation("漫步记录已同步到网页端", done) {
        repository.finish()
        _ui.value = _ui.value.copy(tab = MainTab.ROUTES)
    }

    fun saveApiBase(value: String) = viewModelScope.launch {
        store.setApiBase(value)
        _ui.value = _ui.value.copy(apiBase = store.getApiBase(), notice = "服务地址已保存")
        val user = (_ui.value.session as? AppSession.SignedIn)?.user
        if (user != null) repository.refresh(user)
    }

    private fun runOperation(notice: String, done: () -> Unit = {}, block: suspend () -> Unit) = viewModelScope.launch {
        _ui.value = _ui.value.copy(operationBusy = true, error = null, notice = null)
        try {
            block()
            _ui.value = _ui.value.copy(notice = notice)
            done()
        } catch (error: Exception) {
            if (error is ApiException && error.status == 401) {
                store.saveUser(null)
                _ui.value = _ui.value.copy(session = AppSession.SignedOut, error = "登录已过期，请重新登录")
            } else _ui.value = _ui.value.copy(error = error.message ?: "操作失败")
        } finally {
            _ui.value = _ui.value.copy(operationBusy = false)
        }
    }
}
