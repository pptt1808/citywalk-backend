package com.citywalk.pulse

import android.app.Application
import com.citywalk.pulse.data.ApiClient
import com.citywalk.pulse.data.LocalStore
import com.citywalk.pulse.data.WalkRepository
import kotlinx.serialization.json.Json

class CityWalkApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        AmapPrivacy.restoreAcceptedConsent(this)
    }

    val json: Json by lazy {
        Json {
            ignoreUnknownKeys = true
            explicitNulls = false
            encodeDefaults = true
            isLenient = true
        }
    }
    val store: LocalStore by lazy { LocalStore(this, json) }
    val api: ApiClient by lazy { ApiClient(this, json, store) }
    val walkRepository: WalkRepository by lazy { WalkRepository(this, api, store, json) }
}
