package PACKAGE_NAME;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.widget.RemoteViews;
public class StreakWidgetProvider extends AppWidgetProvider {
 @Override public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
  SharedPreferences prefs=context.getSharedPreferences("lockedin_home_widgets",0);
  int streak=Math.max(0,prefs.getInt("streak",0));
  if(prefs.getBoolean("streak_lapsed",false)) streak=0;
  Intent launch=context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
  if(launch!=null){launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP);}
  PendingIntent tap=launch==null?null:PendingIntent.getActivity(context,4101,launch,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
  for(int id:ids){RemoteViews v=new RemoteViews(context.getPackageName(),R.layout.widget_streak);
   v.setTextViewText(R.id.streak_count,String.valueOf(streak));
   if(tap!=null)v.setOnClickPendingIntent(R.id.streak_widget_root,tap);
   manager.updateAppWidget(id,v);
  }
 }
}