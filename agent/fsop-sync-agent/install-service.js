/**
 * Installation script for Windows Service (optional).
 * Requires: npm install -g node-windows
 * 
 * Run: node install-service.js
 */

const Service = require('node-windows').Service;
const path = require('path');

// Create a new service object
const svc = new Service({
    name: 'FSOP Sync Agent',
    description: 'Agent de synchronisation automatique FSOP → Excel',
    script: path.join(__dirname, 'index.js'),
    nodeOptions: [
        '--harmony',
        '--max_old_space_size=4096'
    ]
});

// Listen for the "install" event, which indicates the process is available as a service.
svc.on('install', function() {
    console.log('Service installed successfully!');
    console.log('Starting service...');
    svc.start();
});

svc.on('start', function() {
    console.log('Service started successfully!');
});

svc.on('error', function(err) {
    console.error('Service error:', err);
});

// Install the service
console.log('Installing service...');
svc.install();




