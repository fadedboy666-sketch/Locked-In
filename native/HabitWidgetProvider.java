package PACKAGE_NAME;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.widget.RemoteViews;
import org.json.JSONArray;
import org.json.JSONObject;
public class HabitWidgetProvider extends AppWidgetProvider {
 public static final String ACTION_DAY_TAP="PACKAGE_NAME.HABIT_WIDGET_DAY_TAP";
 @Override public void onUpdate(Context context, AppWidgetManager manager, int[] ids){for(int id:ids)updateOne(context,manager,id);}
 public static void updateOne(Context context,AppWidgetManager manager,int id){
  SharedPreferences prefs=context.getSharedPreferences("lockedin_home_widgets",0);
  String chosen=prefs.getString("selected_habit_name","");
  RemoteViews v=new RemoteViews(context.getPackageName(),R.layout.widget_habit);
  try{
   JSONArray all=new JSONArray(prefs.getString("habits","[]")); JSONObject habit=null;
   for(int i=0;i<all.length();i++){JSONObject item=all.optJSONObject(i);if(item!=null&&chosen.equals(item.optString("name"))){habit=item;break;}}
   if(habit==null){v.setTextViewText(R.id.habit_widget_title,"Habit unavailable");v.setTextViewText(R.id.habit_widget_subtitle,"Choose a habit again in Locked In Settings");}
   else{
    v.setTextViewText(R.id.habit_widget_title,habit.optString("name","Habit"));
    String metric=habit.optString("metric","");v.setTextViewText(R.id.habit_widget_subtitle,metric);
    JSONArray days=habit.optJSONArray("days");v.removeAllViews(R.id.habit_widget_grid);
    for(int d=0;d<30;d++){
     String status=days==null?"missed":days.optString(d,"missed");
     RemoteViews cell=new RemoteViews(context.getPackageName(),R.layout.widget_habit_cell);
     cell.setTextViewText(R.id.habit_day_number,String.valueOf(d+1));
     int bg=status.equals("done")?R.drawable.widget_cell_done:(status.equals("rest")?R.drawable.widget_cell_rest:R.drawable.widget_cell_missed);
     cell.setInt(R.id.habit_day_number,"setBackgroundResource",bg);
     Intent tap=new Intent(context,HabitWidgetProvider.class);tap.setAction(ACTION_DAY_TAP);tap.putExtra("habit_name",chosen);tap.putExtra("day_index",d);tap.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,id);
     PendingIntent pi=PendingIntent.getBroadcast(context,5000+id*40+d,tap,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
     cell.setOnClickPendingIntent(R.id.habit_day_number,pi);v.addView(R.id.habit_widget_grid,cell);
    }
    
   }
  }catch(Exception ignored){v.setTextViewText(R.id.habit_widget_title,"30-day tracker");}
  Intent launch=context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
  if(launch!=null){launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP);PendingIntent open=PendingIntent.getActivity(context,4200+id,launch,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);v.setOnClickPendingIntent(R.id.habit_widget_root,open);}
  manager.updateAppWidget(id,v);
 }
 @Override public void onReceive(Context context,Intent intent){
  super.onReceive(context,intent);
  if(intent==null||!ACTION_DAY_TAP.equals(intent.getAction()))return;
  String name=intent.getStringExtra("habit_name");int day=intent.getIntExtra("day_index",-1);
  if(name==null||day<0||day>=30)return;
  SharedPreferences prefs=context.getSharedPreferences("lockedin_home_widgets",0);
  try{
   JSONArray pending=new JSONArray(prefs.getString("pending_changes","[]"));JSONObject change=new JSONObject();change.put("habitName",name);change.put("dayIndex",day);pending.put(change);
   prefs.edit().putString("pending_changes",pending.toString()).apply();
  }catch(Exception ignored){}
  Intent launch=context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
  if(launch!=null){launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP);context.startActivity(launch);}
 }
}