import os
import re
from PIL import Image


def flip_target_images(directory="."):
  # Regex pour détecter le pattern : 1 lettre majuscule + 1 ou plusieurs chiffres + .png
  # Ex: A2.png, B1.png, Z10.png
  pattern = re.compile(r"^[A-Z]\d+\.png$")

  count = 0
  for filename in os.listdir(directory):
    if pattern.match(filename):
      file_path = os.path.join(directory, filename)

      try:
        # Ouvrir l'image
        with Image.open(file_path) as img:
          # Retourner l'image verticalement (sens dessus dessous)
          flipped_img = img.transpose(Image.FLIP_TOP_BOTTOM)

          # Sauvegarder directement dans le même fichier (in-place)
          flipped_img.save(file_path)
          print(f"[Succès] Image retournée : {filename}")
          count += 1

      except Exception as e:
        print(f"[Erreur] Impossible de traiter {filename} : {e}")

  print(f"\nTerminé ! {count} image(s) modifiée(s) directement.")


if __name__ == "__main__":
  flip_target_images()