import Tunnelist from './lib/tunnelist'

const host = process.env.TUNNELIST_HOST || '0.0.0.0'
const port = process.env.TUNNELIST_PORT || '22'

new Tunnelist({host, port}).start()