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
                new_script = []
                for line in script_lines:
                    if 'pm.collectionVariables.set' in line and '@xprtlink-test.com' in line:
                        # old line: pm.collectionVariables.set('expert_email', expertFirst.toLowerCase() + '.' + expertLast.toLowerCase() + '.' + seq + '@xprtlink-test.com');
                        # we want to change it to something like 'williams7216@yopmail.com' or 'firstname.lastname7216@yopmail.com'
                        line = line.replace(" + '.' + seq + '@xprtlink-test.com'", " + seq + '@yopmail.com'")
                        modified = True
                    new_script.append(line)
                
                if new_script != script_lines:
                    e['script']['exec'] = new_script

    if modified:
        with open(f, 'w') as file:
            json.dump(data, file, indent=2)
            file.write('\n')
        print(f"Updated email format in {f}")
