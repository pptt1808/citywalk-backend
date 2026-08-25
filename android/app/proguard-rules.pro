# Keep serialization metadata when release minification is enabled later.
-keepattributes *Annotation*, InnerClasses
-dontwarn kotlinx.serialization.**

# 高德地图、搜索及底层渲染。当前 Release 未开启压缩，先保留供后续启用 R8。
-keep class com.amap.api.maps.** { *; }
-keep class com.amap.api.services.** { *; }
-keep class com.autonavi.** { *; }
-dontwarn com.amap.api.**
