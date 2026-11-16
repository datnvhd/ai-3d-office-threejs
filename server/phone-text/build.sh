#!/bin/sh
# Rebuilds apptest-text.dex from AppTestText.java (only needed after changing the .java file; the .dex is committed).
# Needs a JDK 11+ (javac) and the Android SDK (android.jar of any platform >= 30, d8 from build-tools).
#   ANDROID_SDK=/path/to/Android/Sdk JAVA_HOME=/path/to/jdk-11 sh server/phone-text/build.sh
set -e
cd "$(dirname "$0")"
SDK=${ANDROID_SDK:-${ANDROID_HOME:-$HOME/Android/Sdk}}
JAR=$(ls -d "$SDK"/platforms/android-*/android.jar | sort -V | tail -n 1)
D8=$(ls -d "$SDK"/build-tools/*/lib/d8.jar | sort -V | tail -n 1)
JAVA=${JAVA_HOME:+$JAVA_HOME/bin/}
rm -rf out && mkdir out
"${JAVA}javac" --release 8 -cp "$JAR" -d out AppTestText.java
"${JAVA}java" -cp "$D8" com.android.tools.r8.D8 --min-api 21 --lib "$JAR" --output out out/*.class
mv out/classes.dex apptest-text.dex && rm -rf out
echo "apptest-text.dex: $(wc -c < apptest-text.dex) bytes"
