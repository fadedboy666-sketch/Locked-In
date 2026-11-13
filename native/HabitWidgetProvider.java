package PACKAGE_NAME;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.text.TextUtils;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.Calendar;
import android.widget.RemoteViews;
import org.json.JSONArray;
import org.json.JSONObject;
public class HabitWidgetProvider extends AppWidgetProvider {
 public static final String ACTION_DAY_TAP="PACKAGE_NAME.HABIT_WIDGET_DAY_TAP";
 public static final String ACTION_WIDGET_PINNED="PACKAGE_NAME.HABIT_WIDGET_PINNED";
 @Override public void onUpdate(Context context,AppWidgetManager manager,int[] ids){
  SharedPreferences prefs=context.getSharedPreferences("lockedin_home_widgets",0);
  for(int id:ids){
   String key="habit_widget_id_"+id;
   if(!prefs.contains(key))prefs.edit().putString(key,"").apply();
   updateOne(context,manager,id);
  }
 }
 @Override public void onDeleted(Context context,int[] ids){
  super.onDeleted(context,ids);
  SharedPreferences.Editor edit=context.getSharedPreferences("lockedin_home_widgets",0).edit();
  for(int id:ids)edit.remove("habit_widget_id_"+id);
  edit.apply();
 }
 public static void updateOne(Context context,AppWidgetManager manager,int id){
  SharedPreferences prefs=context.getSharedPreferences("lockedin_home_widgets",0);
  String chosenId=prefs.getString("habit_widget_id_"+id,"");
  RemoteViews v=new RemoteViews(context.getPackageName(),R.layout.widget_habit);
  try{
   JSONArray all=new JSONArray(prefs.getString("habits","[]"));JSONObject habit=null;
   for(int i=0;i<all.length();i++){
    JSONObject item=all.optJSONObject(i);
    if(item!=null&&chosenId.equals(item.optString("id",""))){habit=item;break;}
   }
   if(habit==null){
    v.setTextViewText(R.id.habit_widget_title,"Habit unavailable");
    v.setTextViewText(R.id.habit_widget_subtitle,"This habit is no longer in your tracker");
   }else{
    v.setTextViewText(R.id.habit_widget_title,habit.optString("name","Habit"));
    v.setTextViewText(R.id.habit_widget_icon,habit.optString("icon","🎯"));
    v.setTextViewText(R.id.habit_widget_subtitle,habit.optString("metric",""));
    JSONArray days=habit.optJSONArray("days");
    v.removeAllViews(R.id.habit_widget_grid);
    String first=habit.optString("firstUseDate","");
    String created=habit.optString("createdOn",first);
    String today=new SimpleDateFormat("yyyy-MM-dd",Locale.US).format(new Date());
    SimpleDateFormat parser=new SimpleDateFormat("yyyy-MM-dd",Locale.US);
    Calendar dayCalendar=Calendar.getInstance();
    try{if(!first.isEmpty())dayCalendar.setTime(parser.parse(first));}catch(Exception ignored){}
    for(int d=0;d<30;d++){
     String dateKey=parser.format(dayCalendar.getTime());
     boolean active=!first.isEmpty()&&dateKey.compareTo(created)>=0&&dateKey.compareTo(today)<=0;
     String status=days==null?"missed":days.optString(d,"missed");
     RemoteViews cell=new RemoteViews(context.getPackageName(),R.layout.widget_habit_cell);
     cell.setTextViewText(R.id.habit_day_number,String.valueOf(d+1));
     int bg=!active?R.drawable.widget_cell_inactive:(status.equals("done")?R.drawable.widget_cell_done:(status.equals("rest")?R.drawable.widget_cell_rest:R.drawable.widget_cell_missed));
     cell.setInt(R.id.habit_day_number,"setBackgroundResource",bg);
     cell.setTextColor(R.id.habit_day_number,active?Color.WHITE:0x55777777);
     if(active){
      Intent tap=new Intent(context,HabitWidgetProvider.class);
      tap.setAction(ACTION_DAY_TAP);tap.putExtra("habit_id",chosenId);tap.putExtra("day_index",d);tap.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,id);
      PendingIntent pi=PendingIntent.getBroadcast(context,5000+id*40+d,tap,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
      cell.setOnClickPendingIntent(R.id.habit_day_number,pi);
     }
     v.addView(R.id.habit_widget_grid,cell);dayCalendar.add(Calendar.DAY_OF_YEAR,1);
    }
   }
  }catch(Exception ignored){v.setTextViewText(R.id.habit_widget_title,"Habit tracker");}
  Intent launch=context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
  if(launch!=null){launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP);PendingIntent open=PendingIntent.getActivity(context,4200+id,launch,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);v.setOnClickPendingIntent(R.id.habit_widget_root,open);}
  manager.updateAppWidget(id,v);
 }
 @Override public void onReceive(Context context,Intent intent){
  super.onReceive(context,intent);
  if(intent==null)return;
  if(ACTION_WIDGET_PINNED.equals(intent.getAction())){
   int widgetId=intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,AppWidgetManager.INVALID_APPWIDGET_ID);
   String pinnedHabitId=intent.getStringExtra("habit_id");
   if(widgetId!=AppWidgetManager.INVALID_APPWIDGET_ID&&!TextUtils.isEmpty(pinnedHabitId)){
    context.getSharedPreferences("lockedin_home_widgets",0).edit().putString("habit_widget_id_"+widgetId,pinnedHabitId).apply();
    updateOne(context,AppWidgetManager.getInstance(context),widgetId);
   }
   return;
  }
  if(!ACTION_DAY_TAP.equals(intent.getAction()))return;
  String habitId=intent.getStringExtra("habit_id");int day=intent.getIntExtra("day_index",-1);
  if(TextUtils.isEmpty(habitId)||day<0||day>=30)return;
  SharedPreferences prefs=context.getSharedPreferences("lockedin_home_widgets",0);
  try{
   JSONArray pending=new JSONArray(prefs.getString("pending_changes","[]"));
   JSONObject change=new JSONObject();change.put("habitId",habitId);change.put("dayIndex",day);pending.put(change);
   prefs.edit().putString("pending_changes",pending.toString()).apply();
  }catch(Exception ignored){}
  Intent launch=context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
  if(launch!=null){launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP);context.startActivity(launch);}
 }
}