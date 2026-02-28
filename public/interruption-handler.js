class InterruptionHandler {
    constructor() {
        this.socket = null;
        this.isListening = false;
    }

    startListening() {
        if (this.isListening) return;
        // Code to initialize and start speech recognition
        console.log('Speech recognition started');
        this.isListening = true;
    }

    stopListening() {
        if (!this.isListening) return;
        // Code to stop speech recognition
        console.log('Speech recognition stopped');
        this.isListening = false;
    }

    handleInterruption() {
        console.log('Speech interrupted');
        this.stopListening();
        this.startListening(); // Optionally restart listening
    }

    connectWebSocket(url) {
        this.socket = new WebSocket(url);
        this.socket.onopen = () => {
            console.log('WebSocket connection established');
        };
        this.socket.onmessage = (message) => {
            console.log('Message from server:', message.data);
        };
        this.socket.onclose = () => {
            console.log('WebSocket connection closed');
        };
    }

    disconnectWebSocket() {
        if (this.socket) {
            this.socket.close();
            console.log('WebSocket connection disconnected');
        }
    }
}

module.exports = InterruptionHandler;