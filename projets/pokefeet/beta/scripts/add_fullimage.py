import json
import os
import shutil

def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    json_path = os.path.normpath(os.path.join(script_dir, '..', 'data', 'pokemons.json'))

    if not os.path.exists(json_path):
        print(f"Error: file not found: {json_path}")
        return

    bak_path = json_path + '.bak'
    shutil.copyfile(json_path, bak_path)

    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    updated = 0
    for item in data:
        idx = item.get('Index')
        if isinstance(idx, str) and idx.isdigit():
            if not item.get('FullImage'):
                # use int(idx) to avoid leading zeros
                item['FullImage'] = f"https://s3.pokeos.com/pokeos-uploads/assets/pokemon/home/render/{int(idx)}.png"
                updated += 1

    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"Updated {updated} entries. Backup saved to: {bak_path}")

if __name__ == '__main__':
    main()
