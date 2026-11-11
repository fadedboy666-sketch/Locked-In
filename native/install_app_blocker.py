from pathlib import Path
import re
import shutil

root = Path('android/app/src/main')
java_root = root / 'java'
main_activity = next(java_root.rglob('MainActivity.java'), None)
if main_activity is None:
    raise SystemExit('Capacitor MainActivity.java was not generated.')
main_text = main_activity.read_text()
match = re.search(r'^package\s+([\w.]+);', main_text, re.M)
if not match:
    raise SystemExit('Could not determine Android package name.')
package_name = match.group(1)
package_dir = java_root.joinpath(*package_name.split('.'))
package_dir.mkdir(parents=True, exist_ok=True)

for filename in ('AppBlockerPlugin.java', 'AppBlockerAccessibilityService.java'):
    source = Path('native') / filename
    if not source.exists():
        raise SystemExit(f'Missing native source: {source}')
    (package_dir / filename).write_text(source.read_text().replace('PACKAGE_NAME', package_name))

plugin_import = f'import {package_name}.AppBlockerPlugin;'
if plugin_import not in main_text:
    anchor_import = 'import com.getcapacitor.BridgeActivity;'
    if anchor_import not in main_text:
        raise SystemExit('Could not safely add AppBlockerPlugin import to MainActivity.')
    main_text = main_text.replace(anchor_import, anchor_import + '\n' + plugin_import, 1)
if 'registerPlugin(AppBlockerPlugin.class);' not in main_text:
    anchor = 'super.onCreate(savedInstanceState);'
    if anchor not in main_text:
        raise SystemExit('Could not safely register AppBlockerPlugin in MainActivity.')
    main_text = main_text.replace(anchor, 'registerPlugin(AppBlockerPlugin.class);\n        ' + anchor, 1)
main_activity.write_text(main_text)

manifest = root / 'AndroidManifest.xml'
xml = manifest.read_text()
if '<queries>' not in xml:
    queries = '''\n    <queries>\n        <intent>\n            <action android:name="android.intent.action.MAIN" />\n            <category android:name="android.intent.category.LAUNCHER" />\n        </intent>\n    </queries>\n'''
    xml = re.sub(r'(<manifest\b[^>]*>)', lambda m: m.group(1) + queries, xml, count=1)

service_name = package_name + '.AppBlockerAccessibilityService'
if service_name not in xml:
    service = f'''\n        <service\n            android:name="{service_name}"\n            android:permission="android.permission.BIND_ACCESSIBILITY_SERVICE"\n            android:exported="true">\n            <intent-filter>\n                <action android:name="android.accessibilityservice.AccessibilityService" />\n            </intent-filter>\n            <meta-data\n                android:name="android.accessibilityservice"\n                android:resource="@xml/app_blocker_accessibility_service_config" />\n        </service>\n'''
    xml = xml.replace('</application>', service + '    </application>', 1)
manifest.write_text(xml)

xml_dir = root / 'res' / 'xml'
xml_dir.mkdir(parents=True, exist_ok=True)
shutil.copy2(Path('native/res/xml/app_blocker_accessibility_service_config.xml'),
             xml_dir / 'app_blocker_accessibility_service_config.xml')

values = root / 'res' / 'values'
values.mkdir(parents=True, exist_ok=True)
strings = values / 'strings.xml'
content = strings.read_text() if strings.exists() else '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n</resources>\n'
string = '<string name="app_blocker_accessibility_description">Allows Locked In to detect selected apps while blocking is enabled.</string>'
if 'app_blocker_accessibility_description' not in content:
    content = content.replace('</resources>', '    ' + string + '\n</resources>')
strings.write_text(content)

logo_source = Path('www/icon-512.png')
if not logo_source.exists():
    raise SystemExit('Missing www/icon-512.png. App Blocker requires the real Locked In logo asset.')
logo_dir = root / 'res' / 'drawable-nodpi'
logo_dir.mkdir(parents=True, exist_ok=True)
shutil.copy2(logo_source, logo_dir / 'locked_in_logo.png')
print('App Blocker plugin, Accessibility Service, launcher-app visibility query, service metadata, and exact Locked In logo installed.')
