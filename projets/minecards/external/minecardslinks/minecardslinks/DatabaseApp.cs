using System;
using Microsoft.Data.Sqlite;

namespace minecardslinks
{
    internal static class DatabaseApp
    {
        private const string DbFileName = "minecards_links.sqlite";
        private static readonly string ConnectionString = $"Data Source={DbFileName}";

        public static void Initialize()
        {
            using var connection = new SqliteConnection(ConnectionString);
            connection.Open();

            var command = connection.CreateCommand();
            command.CommandText = @"
                CREATE TABLE IF NOT EXISTS Links (
                    ID TEXT PRIMARY KEY,
                    Username TEXT NOT NULL,
                    UUID TEXT NOT NULL
                );";
            command.ExecuteNonQuery();
        }

        public static void SaveOrUpdate(LinkObject link)
        {
            using var connection = new SqliteConnection(ConnectionString);
            connection.Open();

            var command = connection.CreateCommand();
            command.CommandText = @"
                INSERT INTO Links (ID, Username, UUID)
                VALUES (@id, @username, @uuid)
                ON CONFLICT(ID) DO UPDATE SET
                    Username = @username,
                    UUID = @uuid;";

            command.Parameters.AddWithValue("@id", link.ID);
            command.Parameters.AddWithValue("@username", link.Username);
            command.Parameters.AddWithValue("@uuid", link.UUID);

            command.ExecuteNonQuery();
        }

        /// <summary>
        /// Lit le lien enregistré pour un ID (GET /GetUuid), sans rien modifier.
        /// </summary>
        /// <returns>Le lien trouvé, ou null quand cet ID n'est pas en base.</returns>
        public static LinkObject GetById(string id)
        {
            using var connection = new SqliteConnection(ConnectionString);
            connection.Open();

            var command = connection.CreateCommand();
            command.CommandText = @"
                SELECT ID, Username, UUID
                FROM Links
                WHERE ID = @id
                LIMIT 1;";
            command.Parameters.AddWithValue("@id", id);

            using var reader = command.ExecuteReader();
            if (!reader.Read())
                return null;

            return new LinkObject(reader.GetString(0), reader.GetString(1), reader.GetString(2));
        }
    }
}