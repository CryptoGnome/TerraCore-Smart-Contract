function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

async function retryWithBackoff(fn, options = {}) {
    const {
        maxAttempts = 3,
        initialDelay = 1000,
        maxDelay = 30000,
        backoffMultiplier = 2,
        functionName = 'unknown'
    } = options;

    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            if (attempt === maxAttempts) {
                console.error(`[${functionName}] All ${maxAttempts} attempts failed`);
                throw error;
            }

            const delay = Math.min(initialDelay * Math.pow(backoffMultiplier, attempt - 1), maxDelay);
            console.log(`[${functionName}] Attempt ${attempt}/${maxAttempts} failed: ${error.message}. Retrying in ${delay}ms...`);
            await sleep(delay);
        }
    }
    throw lastError;
}

module.exports = { sleep, retryWithBackoff };
