class Code {
    constructor(data) {
        this.code = data.Code;
        this.isUnique = data.IsUnique;
        this.pokes = data.Pokes || [];
        this.money = data.Money || 0;
        this.items = data.Items || [];
        this.expiration = data.Expiration ? new Date(data.Expiration) : null;
    }

    /**
     * Check if the code is valid based on current date and expiration
     */
    isExpired() {
        if (!this.expiration) {
            return false;
        }
        return new Date() > this.expiration;
    }

    /**
     * Get all rewards from this code
     */
    getRewards() {
        return {
            pokes: this.pokes,
            money: this.money,
            items: this.items
        };
    }

    /**
     * Check if this code has been used (for unique codes)
     */
    hasBeenUsed() {
        if (!this.isUnique) {
            return false;
        }
        const usedCodes = JSON.parse(localStorage.getItem('usedCodes') || '[]');
        return usedCodes.includes(this.code);
    }

    /**
     * Mark this code as used
     */
    markAsUsed() {
        if (this.isUnique) {
            const usedCodes = JSON.parse(localStorage.getItem('usedCodes') || '[]');
            if (!usedCodes.includes(this.code)) {
                usedCodes.push(this.code);
                localStorage.setItem('usedCodes', JSON.stringify(usedCodes));
            }
        }
    }
}
