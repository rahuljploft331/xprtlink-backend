import json
import glob

PREREQ_TEMPLATE = """
var firstNames = ["James", "Sarah", "Michael", "Emma", "William", "Olivia", "David", "Ava", "Richard", "Sophia", "Joseph", "Isabella", "Thomas", "Mia", "Charles", "Charlotte", "Daniel", "Amelia", "Matthew", "Harper"];
var lastNames = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin"];
function rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
var ts = Date.now();
var seq = String(ts).slice(-6);
"""

NAME_MAPPINGS = [
    ("Morgan", "EmailExpert"),
    ("Taylor", "SubFlow"),
    ("Alex", "Testuser"),
    ("MsgCust", "FlowG"),
    ("MsgExpert", "FlowG"),
    ("Jordan", "ExpertUser"),
    ("ConsultCust", "FlowF"),
    ("ConsultExpert", "FlowF")
]

for f in glob.glob('/home/jploft-php/Documents/xpertlink/xpertlink-backend/scripts/flows/*.json'):
    with open(f) as file:
        data = json.load(file)
    
    modified = False
    for i in data.get('item', []):
        for e in i.get('event', []):
            if e.get('listen') == 'prerequest':
                script_lines = e['script']['exec']
                new_script = []
                added_mock = False
                for line in script_lines:
                    if 'pm.collectionVariables.set' in line and '_email\'' in line:
                        if not added_mock:
                            new_script.extend(PREREQ_TEMPLATE.strip().split('\n'))
                            added_mock = True
                        
                        var_name = line.split("'")[1]  
                        prefix = var_name.split('_')[0] 
                        
                        new_script.append(f"var {prefix}First = rand(firstNames);")
                        new_script.append(f"var {prefix}Last = rand(lastNames);")
                        new_script.append(f"pm.collectionVariables.set('{prefix}_first_name', {prefix}First);")
                        new_script.append(f"pm.collectionVariables.set('{prefix}_last_name', {prefix}Last);")
                        new_script.append(f"pm.collectionVariables.set('{var_name}', {prefix}First.toLowerCase() + '.' + {prefix}Last.toLowerCase() + '.' + seq + '@xprtlink-test.com');")
                    else:
                        if 'var ts = Date.now();' not in line:
                            new_script.append(line)
                
                if new_script != script_lines:
                    e['script']['exec'] = new_script
                    modified = True

        req = i.get('request', {})
        body = req.get('body', {})
        raw_body = body.get('raw', '')
        if raw_body:
            new_raw_body = raw_body
            for first, last in NAME_MAPPINGS:
                if f'"{first}"' in new_raw_body and f'"{last}"' in new_raw_body:
                    if 'expert_email' in new_raw_body:
                        new_raw_body = new_raw_body.replace(f'"{first}"', '"{{expert_first_name}}"')
                        new_raw_body = new_raw_body.replace(f'"{last}"', '"{{expert_last_name}}"')
                    elif 'customer_email' in new_raw_body:
                        new_raw_body = new_raw_body.replace(f'"{first}"', '"{{customer_first_name}}"')
                        new_raw_body = new_raw_body.replace(f'"{last}"', '"{{customer_last_name}}"')
                    elif 'fresh_email' in new_raw_body:
                        new_raw_body = new_raw_body.replace(f'"{first}"', '"{{fresh_first_name}}"')
                        new_raw_body = new_raw_body.replace(f'"{last}"', '"{{fresh_last_name}}"')
            if 'firstName":"Alex"' in new_raw_body and 'lastName":"Johnson"' in new_raw_body:
                 new_raw_body = new_raw_body.replace('"Alex"', '"{{customer_first_name}}"')
                 new_raw_body = new_raw_body.replace('"Johnson"', '"{{customer_last_name}}"')
            if new_raw_body != raw_body:
                body['raw'] = new_raw_body
                modified = True

    if modified:
        with open(f, 'w') as file:
            json.dump(data, file, indent=2)
            file.write('\n')
        print(f"Updated {f}")
