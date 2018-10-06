import ssh2 from 'ssh2'
import keypair from 'keypair'
import { inspect } from 'util'
import net from 'net'


const SIGINT = '\x03'


export default class Tunnelist {
  constructor({ host, port } = {}) {
    this.host = host
    this.port = port
    
    // Bind all onClient methods to this context
    Object.getOwnPropertyNames(this).forEach((prop) => {
      if (prop.startsWith('onClient')) {
        this[prop] = this[prop].bind(this)
      }
    })
    
    this.server = this.createSSHServer()
  }

  createSSHServer() {
    return new ssh2.Server({
      hostKeys: [keypair().private]
    }, this.onClientConnected)
  }
  
  onClientConnected() {
      console.log('Client connected')

      client
        .on('authentication', this.onClientAuthentication)
        .on('ready', this.onClientReady)
        .on('end', this.onClientDisconnected)
  }
  
  onClientAuthentication(ctx) {
    if (ctx.method === 'publickey') {
      ctx.accept()
    } else {
      ctx.reject()
    }
  }
  
  onClientReady () {
    console.log('Client authenticated')

    client.on('session', this.onClientSession)

    client.on('request', this.onClientRequest)
  }
  
  onClientSession (accept, reject) {
    let session = accept()
    
    session.once('exec', this.onClientSessionExec)

    session.on('pty', this.onClientSessionPty)

    session.on('shell', this.onClientSessionShell)
  }
  
  onClientSessionExec (accept, reject, info) {
    console.log('Client wants to execute: ' + inspect(info.command))
    var stream = accept()
    stream.write(inspect(info.command))
    stream.exit(0)
    stream.end()
  }
  
  onClientSessionPty (accept, reject, info) {
    console.log('Client wants a pty session')
    accept()
  }
  
  onClientSessionShell (accept, reject, info) {
    console.log('Client wants a shell')
    const channel = accept()
    channel.on('data', function (chunk) {
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
  }
  
  onClientRequest (accept, reject, name, info) {
    if (name !== 'tcpip-forward') {
      console.log(`Client wants ${name} but we don't provide it`)
      reject()
      return
    }
    console.log('Client wants ' + name, info)
    accept()
    
    const server = this.createTcpServer()
    
    server.listen(info.bindPort, () => {
      console.log('tunnel tcp server started')
    })
  }
  
  onClientDisconnected() {
    console.log('client disconnected')
  }
  
  createTcpServer() {
    const server = net.createServer()
    
    server.on('connection', (conn) => {
      console.log('client connected to tcp tunnel server')
      
      conn.on('data', (chunk) => {
        console.debug('received from client', chunk)
        forwardStream().then(stream => {
          stream.write(chunk)
          console.debug('wrote to remote', chunk)
        }).catch(err => {
          console.debug('error when getting stream ', err)
        })
      })
      conn.on('error', (err) => {
        console.error(err)
      })
      conn.on('end', () => {
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
        forwardStream._promise = new Promise((resolve, reject) => {
          let upperPort = 65535
          let lowerPort = 49152
          let randomPort = Math.floor(Math.random() * (upperPort - lowerPort)) + lowerPort
          client.forwardOut(info.bindAddr, info.bindPort, '127.0.0.1', randomPort,
            function (err, stream) {
              if (err) {
                return reject(err)
              }
              console.log('forward stream created', randomPort)
              stream.on('data', (chunk) => {
                console.log('wrote to client', chunk)
                conn.write(chunk)
              })
              stream.on('error', (err) => {
                console.error(err)
              })
              stream.on('end', () => { forwardStream._promise = null })
              resolve(stream)
            }
          )
        })
        return forwardStream._promise
      }
    })
    
    return server
  }

  start() {
    return this.server.listen(this.port, this.host, function () {
      console.log(`listening on ${this.host}:${this.address().port}`)
    })
  }
}
