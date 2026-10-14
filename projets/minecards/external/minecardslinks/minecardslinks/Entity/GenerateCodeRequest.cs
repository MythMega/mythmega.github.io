using System;
using System.Collections.Generic;
using System.Text;

namespace minecardslinks.Entity
{
    public class GenerateCodeRequest
    {
        public string Type { get; set; }      // "card" | "booster" | "spark"
        public string ID { get; set; }        // booster : id d'extension / card : Index de la carte / spark : ignoré
        public int Quantity { get; set; }     // 1 à 65535
        public string UUID { get; set; }      // UUID Minecards du joueur destinataire
        public string Layout { get; set; }    // card uniquement : "classic" (défaut) ou "fullart"
    }
}