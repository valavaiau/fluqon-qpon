from pathlib import Path
import re
root=Path(__file__).resolve().parent
parts=[]
for name in ['community-policy.mjs','community.mjs','brevo.mjs','worker.mjs']:
 source=(root/name).read_text()
 source=re.sub(r'^import .*?;\n','',source,flags=re.M)
 if name!='worker.mjs':source=re.sub(r'^export ','',source,flags=re.M)
 parts.append(source)
(root.parent/'dist/_worker.js').write_text('\n'.join(parts))
