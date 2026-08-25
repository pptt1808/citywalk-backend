package com.citywalk.pulse

import android.content.Context
import com.amap.api.maps.MapsInitializer
import com.amap.api.services.core.ServiceSettings

object AmapPrivacy {
    private const val PREFS = "citywalk_privacy"
    private const val ACCEPTED = "amap_privacy_accepted"

    fun isAccepted(context: Context): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(ACCEPTED, false)

    fun accept(context: Context) {
        applyAcceptedConsent(context.applicationContext)
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putBoolean(ACCEPTED, true).apply()
    }

    fun restoreAcceptedConsent(context: Context) {
        if (isAccepted(context)) applyAcceptedConsent(context.applicationContext)
    }

    private fun applyAcceptedConsent(context: Context) {
        MapsInitializer.updatePrivacyShow(context, true, true)
        MapsInitializer.updatePrivacyAgree(context, true)
        ServiceSettings.updatePrivacyShow(context, true, true)
        ServiceSettings.updatePrivacyAgree(context, true)
    }
}
