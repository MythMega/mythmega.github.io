using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;
using System.Text;

namespace minecardslinks
{
    internal class LinkObject
    {
        // ID twitch/youtube/discord
        // doit être unique en base de donnée, donc on peut l'utiliser pour identifier l'utilisateur
        public string ID { get; set; }

        // Username twitch/youtube/discord
        public string Username { get; set; }

        // UUID Minecards
        // doit être de cette forme : 00000000-0000-0000-0000-000000000000
        public string UUID { get; set; }

        public LinkObject(string id, string username, string uuid)
        {
            ID = id;
            Username = username;
            UUID = uuid;
        }
    }
}