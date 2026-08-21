import json
import glob

for f in glob.glob('/home/jploft-php/Documents/xpertlink/xpertlink-backend/scripts/flows/*.json'):
    with open(f) as file:
        data = json.load(file)
    
    modified = False
    
    if data.get('item'):
        first_item = data['item'][0]
        for e in first_item.get('event', []):
            if e.get('listen') == 'prerequest':
                script_lines = e['script']['exec']
                new_script = []
                for line in script_lines:
                    if line == "if (expertGender === 'female') {":
                        line = "if (Math.random() > 0.5) {"
                        modified = True
                    new_script.append(line)
                
                if new_script != script_lines:
                    e['script']['exec'] = new_script

    if modified:
        with open(f, 'w') as file:
            json.dump(data, file, indent=2)
            file.write('\n')
        print(f"Fixed script in {f}")
