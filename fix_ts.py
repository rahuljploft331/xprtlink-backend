import json
import glob

for f in glob.glob('/home/jploft-php/Documents/xpertlink/xpertlink-backend/scripts/flows/*.json'):
    with open(f) as file:
        data = json.load(file)
    
    modified = False
    for i in data.get('item', []):
        for e in i.get('event', []):
            if e.get('listen') == 'prerequest':
                script_lines = e['script']['exec']
                has_ts = False
                needs_ts = False
                for line in script_lines:
                    if 'var ts = Date.now();' in line:
                        has_ts = True
                    if 'ts' in line and not 'var ts' in line:
                        needs_ts = True
                
                if needs_ts and not has_ts:
                    e['script']['exec'].insert(0, "var ts = Date.now();")
                    modified = True

    if modified:
        with open(f, 'w') as file:
            json.dump(data, file, indent=2)
            file.write('\n')
        print(f"Fixed ts in {f}")
