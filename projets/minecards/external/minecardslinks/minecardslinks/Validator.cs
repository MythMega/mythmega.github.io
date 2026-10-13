using System;

namespace minecardslinks
{
    internal static class Validator
    {
        public static bool IsValidUuid(string uuid)
        {
            if (string.IsNullOrWhiteSpace(uuid))
                return false;

            // Le format "D" correspond exactement à 00000000-0000-0000-0000-000000000000
            return Guid.TryParseExact(uuid, "D", out _);
        }
    }
}