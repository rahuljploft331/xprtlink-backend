import json
import glob

# Step templates
get_url_step = {
  "name": "Get Customer Avatar Upload URL",
  "event": [
    {
      "listen": "test",
      "script": {
        "exec": [
          "pm.test(\"Status 200\", function () {",
          "    pm.response.to.have.status(200);",
          "});",
          "var res = pm.response.json();",
          "if (res.data && res.data.uploadUrl) {",
          "    pm.collectionVariables.set(\"customer_avatar_upload_url\", res.data.uploadUrl);",
          "    pm.collectionVariables.set(\"customer_avatar_media_id\", res.data.mediaId);",
          "}"
        ],
        "type": "text/javascript"
      }
    }
  ],
  "request": {
    "auth": { "type": "bearer", "bearer": [ { "key": "token", "value": "{{accessToken}}", "type": "string" } ] },
    "method": "POST",
    "header": [ { "key": "Content-Type", "value": "application/json" } ],
    "body": {
      "mode": "raw",
      "raw": "{\n  \"purpose\": \"avatar\",\n  \"mimeType\": \"image/jpeg\",\n  \"sizeBytes\": 50000\n}"
    },
    "url": {
      "raw": "{{base_url}}/api/v1/media/upload-url",
      "host": [ "{{base_url}}" ],
      "path": [ "api", "v1", "media", "upload-url" ]
    }
  },
  "response": []
}

upload_s3_step = {
  "name": "Upload Customer Avatar to S3",
  "event": [
    {
      "listen": "test",
      "script": {
        "exec": [
          "pm.test(\"Status 200\", function () {",
          "    pm.response.to.have.status(200);",
          "});"
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
      "file": {
        "src": "{{customer_avatar_file_src}}"
      }
    },
    "url": {
      "raw": "{{customer_avatar_upload_url}}",
      "host": [ "{{customer_avatar_upload_url}}" ]
    }
  },
  "response": []
}

confirm_upload_step = {
  "name": "Confirm Customer Avatar Upload",
  "event": [
    {
      "listen": "test",
      "script": {
        "exec": [
          "pm.test(\"Status 200\", function () {",
          "    pm.response.to.have.status(200);",
          "});"
        ],
        "type": "text/javascript"
      }
    }
  ],
  "request": {
    "auth": { "type": "bearer", "bearer": [ { "key": "token", "value": "{{accessToken}}", "type": "string" } ] },
    "method": "POST",
    "header": [],
    "url": {
      "raw": "{{base_url}}/api/v1/media/{{customer_avatar_media_id}}/confirm",
      "host": [ "{{base_url}}" ],
      "path": [ "api", "v1", "media", "{{customer_avatar_media_id}}", "confirm" ]
    }
  },
  "response": []
}

prereq_addition = [
  "const femalePhotos = ['seeder/data/photos/female/0ef4fb566361e80ca99f818a8b5e9200383002fc.jpg', 'seeder/data/photos/female/4be62b388ec3aa5861505e44555b314e5651c7fa.png', 'seeder/data/photos/female/b023b22825c5f5c7b1835eacc84c40fdb95f5101.jpg', 'seeder/data/photos/female/brantley-neal-UVUMHL-DzVM-unsplash.jpg'];",
  "const malePhotos = ['seeder/data/photos/male/albert-dera-ILip77SbmOE-unsplash.jpg', 'seeder/data/photos/male/alex-suprun-ZHvM3XIOHoE-unsplash.jpg', 'seeder/data/photos/male/ali-morshedlou-WMD64tMfc4k-unsplash.jpg', 'seeder/data/photos/male/joseph-gonzalez-iFgRcqHznqg-unsplash.jpg', 'seeder/data/photos/male/jurica-koletic-7YVZYZeITc8-unsplash.jpg'];",
  "if (Math.random() > 0.5) {",
  "    pm.collectionVariables.set('customer_avatar_file_src', femalePhotos[Math.floor(Math.random() * femalePhotos.length)]);",
  "} else {",
  "    pm.collectionVariables.set('customer_avatar_file_src', malePhotos[Math.floor(Math.random() * malePhotos.length)]);",
  "}"
]

for f in glob.glob('/home/jploft-php/Documents/xpertlink/xpertlink-backend/scripts/flows/*.json'):
    with open(f) as file:
        data = json.load(file)
    
    modified = False
    
    if data.get('item'):
        first_item = data['item'][0]
        for e in first_item.get('event', []):
            if e.get('listen') == 'prerequest':
                script_lines = e['script']['exec']
                if not any('customer_avatar_file_src' in line for line in script_lines):
                    script_lines.extend(prereq_addition)
                    modified = True

    new_items = []
    for i in data.get('item', []):
        if i.get('name') == 'Step 3: Update Customer Profile':
            if not any(x.get('name') == 'Get Customer Avatar Upload URL' for x in new_items):
                new_items.append(get_url_step)
                new_items.append(upload_s3_step)
                new_items.append(confirm_upload_step)
                
                body = i.get('request', {}).get('body', {})
                if body.get('mode') == 'raw':
                    try:
                        raw_json = json.loads(body['raw'])
                        raw_json['avatarMediaId'] = "{{customer_avatar_media_id}}"
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
        print(f"Injected customer avatar flow to {f}")

