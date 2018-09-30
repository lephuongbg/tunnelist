import ssh2 from 'ssh2'
import keypair from 'keypair'
import {inspect} from 'util'
import net from 'net'


const HOST = process.env.TUNNELIST_HOST || '0.0.0.0'
const PORT = process.env.TUNNELIST_PORT || '22'

new ssh2.Server({
    hostKeys: [keypair().private]
}, function (client) {
    console.log('Client connected')

    client.on('authentication', function (ctx) {
        if (ctx.method === 'publickey') {
            ctx.accept()
        } else {
            ctx.reject()
        }
    }).on('ready', function () {
        console.log('Client authenticated')

        client.on('session', function (accept, reject) {
            var session = accept()
            session.once('exec', function (accept, reject, info) {
                console.log('Client wants to execute: ' + inspect(info.command))
                var stream = accept()
                stream.write(inspect(info.command))
                stream.exit(0)
                stream.end()
            })

            session.on('pty', function (accept, reject, info) {
                console.log('Client wants a pty session')
                accept()
            })

            session.on('shell', function (accept, reject, info) {
                console.log('Client wants a shell')
                const channel = accept()
                channel.on('data', function (chunk) {
                    const SIGINT = '\x03'
                    switch (chunk.toString()) {
                        case SIGINT:
                            console.log('Client sends SIGINT')
                            channel.exit(0)
                            channel.end()
                            break
                        default:
                            console.log('Unhandled input: ', chunk)
                            channel.write(`Unhandled input: <Buffer ${chunk.toString('hex')}>\n\r`)
                            break
                    }
                })
            })
        })

        client.on('request', function (accept, reject, name, info) {
            if (name != 'tcpip-forward') {
                console.log(`Client wants ${name} but we don't provide it`)
                reject()
                return
            }
            console.log('Client wants ' + name, info)
            accept()
            const server = net.createServer()
            server.on('connection', (c) => {
                console.log('client connected to tunnel server')
                c.on('data', (chunk) => {
                    console.log('received from client', chunk)
                    forwardStream().then(stream => {
                        console.log('wrote to remote', chunk)
                        stream.write(chunk)
                    }).catch(err => {
                        console.log('error when getting stream ', err)
                    })
                })
                c.on('error', (err) => {
                    console.error(err)
                })
                c.on('end', () => {
                    console.debug('client ended')
                    forwardStream().then(stream => {
                        console.debug('stream ended')
                        stream.end()
                    }).catch(err => {
                        console.error('error when getting stream ', err)
                    })
                })
                function forwardStream() {
                    if (forwardStream._promise) {
                        return forwardStream._promise
                    }
                    return forwardStream._promise = new Promise((resolve, reject) => {
                        let upperPort = 65535
                        let lowerPort = 49152
                        let randomPort = Math.floor(Math.random() * (upperPort - lowerPort)) + lowerPort
                        client.forwardOut(info.bindAddr,info.bindPort,'127.0.0.1', randomPort,
                            function(err, stream) {
                                if (err) {
                                    return reject(err)
                                }
                                console.log('forward stream created', randomPort)
                                stream.on('data', (chunk) => {
                                    console.log('wrote to client', chunk)
                                    c.write(chunk)
                                })
                                stream.on('error', (err) => {
                                    console.error(err)
                                })
                                stream.on('end', () => forwardStream._promise = null)
                                resolve(stream)
                            }
                        )
                    })
                }
            })
            server.listen(info.bindPort, () => {
                console.log('tunnel tcp server started')
            })
        })

        client.on('forwarded-tcpip', function () {
            console.log(arguments)
        })

    }).on('end', function () {
        console.log('client disconnected')
    })
}).listen(PORT, HOST, function () {
    console.log('listening on port ' + this.address().port)
})