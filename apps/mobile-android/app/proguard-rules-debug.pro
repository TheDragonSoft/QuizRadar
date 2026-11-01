# Debug-build-only R8 rules.
#
# The debug build runs R8 to shrink the 62 MB `material-icons-extended` dex
# (the same win the release build gets), but it must stay as readable as an
# unminified build: every class and method keeps its name and every stack
# frame keeps its source line.
-dontobfuscate
-keepattributes SourceFile,LineNumberTable,Signature,Exceptions,InnerClasses,EnclosingMethod

# The Compose tooling (layout inspector, previews) looks classes up by name.
-keep class androidx.compose.ui.tooling.** { *; }
