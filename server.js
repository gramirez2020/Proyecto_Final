const express = require('express');
const { pool, testConnection } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware para parsear JSON
app.use(express.json());

// Probar la conexión a la base de datos al iniciar el servidor
testConnection();

// --- Rutas de la API ---

// Endpoint POST: Validar logueo
app.post('/api/login', async (req, res) => {
 const { correo, contraseña } = req.body;

 if (!correo || !contraseña) {
  return res.status(400).json({ error: 'El correo y la contraseña son obligatorios.' });
 }

 try {
  // 1. Buscar al usuario por correo
  const [rows] = await pool.query('SELECT * FROM usuario WHERE correo = ?', [correo]);
  const user = rows[0];

  if (!user) {
   return res.status(401).json({ error: 'Credenciales inválidas.' });
  }

  if (user.contraseña !== contraseña) {
   return res.status(401).json({ error: 'Credenciales inválidas.' });
  }

  // 3. Inicio de sesión exitoso
  res.status(200).json({ 
    message: 'Inicio de sesión exitoso.', 
    user: { 
      id: user.id_usuario, 
      correo: user.correo,
      nombre: user.nombre,
      rol: user.rol
    } 
  });

 } catch (error) {
  console.error('Error durante el inicio de sesión:', error);
  res.status(500).json({ error: 'Error del servidor.' });
 }
});

// Endpoint GET: Obtener todos los usuarios
app.get('/api/users', async (req, res) => {
 try {
  // Se selecciona también el 'id' que es crucial para la tabla cita_final
  const [rows] = await pool.query('SELECT id_usuario, nombre, correo, rol FROM usuario');
  res.json(rows);
 } catch (error) {
  console.error('Error al obtener usuarios:', error);
  res.status(500).json({ error: 'Error del servidor' });
 }
});

// Endpoint POST: Crear un nuevo usuario
app.post('/api/users', async (req, res) => {
 const { nombre, correo, contraseña, rol } = req.body;

 if (!nombre || !correo || !contraseña || !rol) {
  return res.status(400).json({ error: 'Todos los campos son obligatorios para el registro.' });
 }

 try {
  const [result] = await pool.query('INSERT INTO usuario (nombre, correo, contraseña, rol) VALUES (?, ?, ?, ?)', [nombre, correo, contraseña, rol]);
  res.status(201).json({ 
    message: 'Usuario registrado exitosamente.',
    id: result.insertId, 
    nombre, 
    correo, 
    rol 
  });
 } catch (error) {
  console.error('Error al crear usuario:', error);
  // Asume que si falla, puede ser por duplicidad de correo (clave única)
  if (error.code === 'ER_DUP_ENTRY') {
   return res.status(409).json({ error: 'El correo ya está registrado.' });
  }
  res.status(500).json({ error: 'Error del servidor' });
 }
});

// ---------------------------------------------
// Endpoint POST: Registrar una nueva cita
// ---------------------------------------------
app.post('/api/citas', async (req, res) => {
 // Los campos coinciden con la tabla cita_final
 const { id_medico, id_usuario, fecha, hora, motivo } = req.body;

 // 1. Validar que todos los campos requeridos estén presentes
 if (!id_medico || !id_usuario || !fecha || !hora || !motivo) {
  return res.status(400).json({ error: 'Faltan campos obligatorios: id_medico, id_usuario, fecha, hora y motivo.' });
 }

 try {
  // 2. Insertar la cita en la tabla cita_final
  const query = `
   INSERT INTO cita_final (id_medico, id_usuario, fecha, hora, motivo, estado)
   VALUES (?, ?, ?, ?, ?, 'A')`;
  const [result] = await pool.query(query, [id_medico, id_usuario, fecha, hora, motivo]);

  // 3. Respuesta de éxito
  res.status(201).json({
   message: 'Cita registrada exitosamente.',
   id: result.insertId,
   cita: { id_medico, id_usuario, fecha, hora, motivo, estado: 'A' }
  });

 } catch (error) {
  console.error('Error al registrar la cita:', error);
  // Manejar errores de clave foránea si el id_medico o id_usuario no existen
  if (error.code === 'ER_NO_REFERENCED_ROW_2') {
    return res.status(404).json({ error: 'El ID de médico o usuario no existe.' });
  }
  res.status(500).json({ error: 'Error interno del servidor al registrar la cita.' });
 }
});

// ---------------------------------------------
// Endpoint GET: Obtener todas las citas por ID de usuario
// ---------------------------------------------
app.get('/api/citas/user/:id_usuario', async (req, res) => {
// Obtiene el ID del usuario de los parámetros de la URL
const { id_usuario } = req.params;

// Validación básica del ID
if (isNaN(parseInt(id_usuario))) {
return res.status(400).json({ error: 'El ID de usuario debe ser un número válido.' });
}

try {
// Consulta SQL con JOIN para obtener el nombre del Optómetra (m)
const query = `
SELECT 
c.id,
c.fecha,
c.hora,
c.motivo,
c.estado,
m.nombre AS nombre_medico
FROM cita_final c
JOIN usuario m ON c.id_medico = m.id_usuario
WHERE c.id_usuario = ?
and c.estado='A'
ORDER BY c.fecha DESC, c.hora DESC
`;
const [citas] = await pool.query(query, [id_usuario]);

if (citas.length === 0) {
return res.status(404).json({ message: 'No se encontraron citas para este usuario.' });
}

// Retorna la lista de citas (incluyendo el nombre del Optómetra)
res.status(200).json(citas);

} catch (error) {
console.error('Error al consultar citas por usuario:', error);
res.status(500).json({ error: 'Error interno del servidor al consultar las citas.' });
}
});

// ---------------------------------------------
// Endpoint PUT: Cancelar una cita (actualizar estado a 'C')
// ---------------------------------------------
app.put('/api/citas/cancelar/:id_cita', async (req, res) => {
    const { id_cita } = req.params;

    // Validación básica
    if (isNaN(parseInt(id_cita))) {
        return res.status(400).json({ error: 'El ID de la cita debe ser un número válido.' });
    }

    try {
        // Actualizar el estado de la cita a 'C' (Cancelada)
        // Solo actualiza si la cita está en estado 'A' (Activa)
        const updateQuery = `
            UPDATE cita_final
            SET estado = 'C'
            WHERE id = ? AND estado = 'A'
        `;
        const [result] = await pool.query(updateQuery, [id_cita]);

        if (result.affectedRows === 0) {
            // Podría ser porque el ID no existe o ya estaba cancelada/finalizada
            return res.status(404).json({ message: 'No se encontró la cita activa con el ID proporcionado o ya fue cancelada.' });
        }

        res.status(200).json({ message: `Cita ${id_cita} cancelada exitosamente.` });

    } catch (error) {
        console.error('Error al cancelar la cita:', error);
        res.status(500).json({ error: 'Error interno del servidor al cancelar la cita.' });
    }
});

// Iniciar el servidor
app.listen(PORT, () => {
 console.log(`Servidor escuchando en http://localhost:${PORT}`);
});