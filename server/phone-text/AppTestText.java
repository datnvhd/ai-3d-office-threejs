// Lets `apptest type` type any text (Vietnamese with accents, emoji…) on an Android phone: `adb shell input text` only
// types ASCII. Run on the phone as the adb shell user, nothing to install:
//   CLASSPATH=/data/local/tmp/apptest-text-<size>.dex app_process / AppTestText <base64 of the UTF-8 text>
// It puts the text on the phone's clipboard (as com.android.shell, the way scrcpy does); apptest then presses Paste
// (KEYCODE_PASTE) in the focused field and reads the field back. The text is base64 so no shell or Windows code page
// can change it on the way. (A single ACTION_MULTIPLE key event with the characters would avoid the clipboard, but
// Android's input dispatcher rejects those.)
//
// Rebuild after changing this file: server/phone-text/build.sh (the .dex is committed).
import android.content.ClipData;
import android.os.IBinder;
import android.util.Base64;
import java.lang.reflect.Method;

public class AppTestText {
  public static void main(String[] args) {
    try {
      clip(new String(Base64.decode(args[0], Base64.DEFAULT), "UTF-8"));
      System.out.println("ok");
    } catch (Throwable e) {
      Throwable c = e.getCause() != null ? e.getCause() : e;
      System.out.println("fail " + c);
      System.exit(1);
    }
  }

  // IClipboard.setPrimaryClip has other parameters on each Android version
  // (pkg) · (pkg, userId) · (pkg, attributionTag, userId) · (pkg, attributionTag, userId, deviceId): fill them by type
  static void clip(String text) throws Exception {
    IBinder b = (IBinder) Class.forName("android.os.ServiceManager").getMethod("getService", String.class).invoke(null, "clipboard");
    Object svc = Class.forName("android.content.IClipboard$Stub").getMethod("asInterface", IBinder.class).invoke(null, b);
    ClipData data = ClipData.newPlainText("apptest", text);
    Throwable last = null;
    for (Method m : svc.getClass().getMethods()) {
      if (!m.getName().equals("setPrimaryClip")) continue;
      Class<?>[] p = m.getParameterTypes();
      Object[] v = new Object[p.length];
      boolean pkg = true;
      for (int i = 0; i < p.length; i++) {
        if (p[i] == ClipData.class) v[i] = data;
        else if (p[i] == String.class) { v[i] = pkg ? "com.android.shell" : null; pkg = false; }
        else if (p[i] == int.class) v[i] = 0;
        else if (p[i] == boolean.class) v[i] = false;
      }
      try { m.invoke(svc, v); return; } catch (Throwable e) { last = e; }
    }
    throw new Exception("setPrimaryClip: " + last);
  }
}
