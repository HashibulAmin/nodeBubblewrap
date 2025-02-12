async function robustFetch(url, options = {}, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await fetch(url, options);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response;
      } catch (error) {
        if (attempt === retries) {
          throw error;
        }
        console.warn(`Fetch attempt ${attempt} failed. Retrying...`, error);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }