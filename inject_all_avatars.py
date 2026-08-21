import json
import glob

prereq_addition = [
  "const femalePhotos = ['seeder/data/photos/female/0ef4fb566361e80ca99f818a8b5e9200383002fc.jpg', 'seeder/data/photos/female/4be62b388ec3aa5861505e44555b314e5651c7fa.png', 'seeder/data/photos/female/b023b22825c5f5c7b1835eacc84c40fdb95f5101.jpg', 'seeder/data/photos/female/brantley-neal-UVUMHL-DzVM-unsplash.jpg'];",
  "const malePhotos = ['seeder/data/photos/male/albert-dera-ILip77SbmOE-unsplash.jpg', 'seeder/data/photos/male/alex-suprun-ZHvM3XIOHoE-unsplash.jpg', 'seeder/data/photos/male/ali-morshedlou-WMD64tMfc4k-unsplash.jpg', 'seeder/data/photos/male/joseph-gonzalez-iFgRcqHznqg-unsplash.jpg', 'seeder/data/photos/male/jurica-koletic-7YVZYZeITc8-unsplash.jpg'];",
  "if (Math.random() > 0.5) {",
  "    pm.collectionVariables.set('avatar_file_src', femalePhotos[Math.floor(Math.random() * femalePhotos.length)]);",
  "} else {",
  "    pm.collectionVariables.set('avatar_file_src', malePhotos[Math.floor(Math.random() * malePhotos.length)]);",
  "}"
]

def create_get_url_step(role, auth_header):
    return {
      "name": f"Get {role} Avatar Upload URL",
      "event": [
        {
          "listen": "test",
          "script": {
            "exec": [
              "pm.test(\"Status 200 or 201\", function () { pm.response.to.have.status(201); });",
              "var res = pm.response.json();",
              "if (res.data && res.data.uploadUrl) {",
              f"    pm.collectionVariables.set(\"avatar_upload_url\", res.data.uploadUrl);",
              f"    pm.collectionVariables.set(\"avatar_media_id\", res.data.id);",
              "}"
            ],
            "type": "text/javascript"
          }
        }
      ],
      "request": {
        "method": "POST",
        "header": [ auth_header, { "key": "Content-Type", "value": "application/json" } ],
        "body": {
          "mode": "raw",
          "raw": "{\n  \"purpose\": \"avatar\",\n  \"mimeType\": \"image/jpeg\",\n  \"sizeBytes\": 50000\n}"
        },
        "url": {
          "raw": "{{base_url}}/api/v1/media/uploads",
          "host": [ "{{base_url}}" ],
          "path": [ "api", "v1", "media", "uploads" ]
        }
      },
      "response": []
    }

def create_upload_s3_step(role):
    return {
      "name": f"Upload {role} Avatar to S3",
      "event": [
        {
          "listen": "test",
          "script": {
            "exec": [
              "pm.test(\"Status 200\", function () { pm.response.to.have.status(200); });"
            ],
            "type": "text/javascript"
          }
        }
      ],
      "request": {
        "method": "PUT",
        "header": [ { "key": "Content-Type", "value": "image/jpeg" } ],
        "body": {
          "mode": "file",
          "file": { "src": "{{avatar_file_src}}" }
        },
        "url": {
          "raw": "{{avatar_upload_url}}",
          "host": [ "{{avatar_upload_url}}" ]
        }
      },
      "response": []
    }

def create_confirm_upload_step(role, auth_header):
    return {
      "name": f"Confirm {role} Avatar Upload",
      "event": [
        {
          "listen": "test",
          "script": {
            "exec": [
              "pm.test(\"Status 200\", function () { pm.response.to.have.status(200); });"
            ],
            "type": "text/javascript"
          }
        }
      ],
      "request": {
        "method": "POST",
        "header": [ auth_header ],
        "url": {
          "raw": "{{base_url}}/api/v1/media/{{avatar_media_id}}/confirm",
          "host": [ "{{base_url}}" ],
          "path": [ "api", "v1", "media", "{{avatar_media_id}}", "confirm" ]
        }
      },
      "response": []
    }

for f in glob.glob('/home/jploft-php/Documents/xpertlink/xpertlink-backend/scripts/flows/*.json'):
    with open(f) as file:
        data = json.load(file)
    
    modified = False
    
    if data.get('item'):
        first_item = data['item'][0]
        for e in first_item.get('event', []):
            if e.get('listen') == 'prerequest':
                script_lines = e['script']['exec']
                if not any('avatar_file_src' in line for line in script_lines):
                    script_lines.extend(prereq_addition)
                    modified = True

    new_items = []
    for i in data.get('item', []):
        target_role = None
        if 'Complete Expert Onboarding' in i.get('name', '') or 'Complete Expert Profile' in i.get('name', ''):
            target_role = 'Expert'
        elif 'Update Customer Profile' in i.get('name', ''):
            target_role = 'Customer'
            
        if target_role:
            auth_header = None
            for h in i.get('request', {}).get('header', []):
                if h.get('key') == 'Authorization':
                    auth_header = h
                    break
            
            if not auth_header:
                auth_header = { "key": "Authorization", "value": "Bearer {{accessToken}}" }
                
            if not any(x.get('name') == f'Get {target_role} Avatar Upload URL' for x in new_items):
                new_items.append(create_get_url_step(target_role, auth_header))
                new_items.append(create_upload_s3_step(target_role))
                new_items.append(create_confirm_upload_step(target_role, auth_header))
                
                body = i.get('request', {}).get('body', {})
                if body.get('mode') == 'raw':
                    try:
                        raw_json = json.loads(body['raw'])
                        raw_json['avatarMediaId'] = "{{avatar_media_id}}"
                        body['raw'] = json.dumps(raw_json, separators=(',', ':'))
                    except json.JSONDecodeError:
                        pass
                modified = True
        new_items.append(i)
        
    if modified:
        data['item'] = new_items
        with open(f, 'w') as file:
            json.dump(data, file, indent=2)
            file.write('\n')
        print(f"Injected avatar flow to {f}")

