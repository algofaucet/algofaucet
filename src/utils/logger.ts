const maskSensitiveData = (data: any): any => {
  if (typeof data === 'string' && data.length > 8) {
    return `${data.substring(0, 4)}...${data.substring(data.length - 4)}`;
  }
  if (typeof data === 'object' && data !== null) {
    const masked = { ...data };
    for (const key in masked) {
      if (
        key.toLowerCase().includes('address') ||
        key.toLowerCase().includes('key') ||
        key.toLowerCase().includes('token') ||
        key.toLowerCase().includes('secret') ||
        key.toLowerCase().includes('password') ||
        key.toLowerCase().includes('seed') ||
        key.toLowerCase().includes('phrase')
      ) {
        if (typeof masked[key] === 'string' && masked[key].length > 8) {
          masked[key] = `${masked[key].substring(0, 4)}...${masked[key].substring(masked[key].length - 4)}`;
        }
      }
    }
    return masked;
  }
  return data;
};

export const logger = {
  info: (message: string, data?: any) => {
    if (import.meta.env.DEV) {
      console.log(message, data ? maskSensitiveData(data) : '');
    }
  },

  error: (message: string, error?: any) => {
    if (import.meta.env.DEV) {
      console.error(message, error ? maskSensitiveData(error) : '');
    }
  },

  warn: (message: string, data?: any) => {
    if (import.meta.env.DEV) {
      console.warn(message, data ? maskSensitiveData(data) : '');
    }
  }
};

export default logger;
